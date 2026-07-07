'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { io } from 'socket.io-client'
import { Peer } from 'peerjs';

let peer = null;

// NOT: Canlıya aldığımızda buradaki URL'i değiştireceğiz!
const socket = io('https://proje-sesli-sohbet.onrender.com');

export default function ChatDashboard() {
    const [profile, setProfile] = useState(null)
    const [loading, setLoading] = useState(true)

    const [chatMessages, setChatMessages] = useState([])
    const [currentMessage, setCurrentMessage] = useState('')
    const [activeTab, setActiveTab] = useState('chat')

    const [isInVoice, setIsInVoice] = useState(false)
    const [voiceUsers, setVoiceUsers] = useState([])

    const [isMicMuted, setIsMicMuted] = useState(false);
    const [isDeafened, setIsDeafened] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);

    // TEMA STATE'İ (Varsayılan Dark Mode)
    const [isDarkMode, setIsDarkMode] = useState(true);

    const router = useRouter()
    const localStream = useRef(null)
    const screenStream = useRef(null)
    const peerInstance = useRef(null)
    const screenCalls = useRef({})

    // --- TEMA RENK DEĞİŞKENLERİ ---
    const themeBg = isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800';
    const cardBg = isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
    const inputBg = isDarkMode ? 'bg-slate-950 border-slate-800 text-white placeholder-slate-500' : 'bg-slate-100 border-slate-300 text-slate-900 placeholder-slate-400';
    const bubbleOther = isDarkMode ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-white text-slate-800 border-slate-200 shadow-sm';
    const textMuted = isDarkMode ? 'text-slate-400' : 'text-slate-500';

    // --- SİSTEM BAŞLANGICI ---
    useEffect(() => {
        checkUser()

        const savedChat = localStorage.getItem('chat_history');
        if (savedChat) {
            const parsedChat = JSON.parse(savedChat);
            const oneDayInMs = 24 * 60 * 60 * 1000;
            const now = Date.now();
            const validMessages = parsedChat.filter(msg => (now - msg.timestamp) < oneDayInMs);
            setChatMessages(validMessages);
            localStorage.setItem('chat_history', JSON.stringify(validMessages));
        }

        socket.on('receive_message', (data) => {
            setChatMessages((prev) => {
                const updated = [...prev, data];
                localStorage.setItem('chat_history', JSON.stringify(updated));
                return updated;
            });
        });

        socket.on('room-users', (users) => {
            setVoiceUsers(users);
        });

        socket.on('user-connected', (data) => {
            setVoiceUsers((prev) => {
                if (!prev.some(u => u.peerId === data.peerId)) return [...prev, data];
                return prev;
            });

            if (peerInstance.current && localStream.current && data.peerId) {
                const audioCall = peerInstance.current.call(data.peerId, localStream.current, {
                    metadata: { type: 'audio', username: JSON.parse(localStorage.getItem('aktif_kullanici'))?.kullanici_adi }
                });
                audioCall.on('stream', (remoteStream) => playRemoteStream(remoteStream, data.peerId));

                if (screenStream.current) {
                    const screenCall = peerInstance.current.call(data.peerId, screenStream.current, {
                        metadata: { type: 'screen', username: JSON.parse(localStorage.getItem('aktif_kullanici'))?.kullanici_adi }
                    });
                    screenCalls.current[data.peerId] = screenCall;
                }
            }
        });

        socket.on('user-disconnected', (peerId) => {
            setVoiceUsers((prev) => prev.filter(u => u.peerId !== peerId));
            const audioEl = document.getElementById(`audio-${peerId}`);
            if (audioEl) audioEl.remove();
            removeRemoteVideo(peerId);
        });

        return () => {
            socket.off('receive_message');
            socket.off('room-users');
            socket.off('user-connected');
            socket.off('user-disconnected');
        }
    }, [])

    const checkUser = () => {
        const userStr = localStorage.getItem('aktif_kullanici')
        if (!userStr) {
            router.push('/')
            return
        }
        setProfile(JSON.parse(userStr))
        setLoading(false)
    }

    const playRemoteStream = (remoteStream, peerId) => {
        if (!document.getElementById(`audio-${peerId}`)) {
            const audio = new Audio();
            audio.id = `audio-${peerId}`;
            audio.srcObject = remoteStream;
            audio.autoplay = true;
            audio.muted = isDeafened;
            document.body.appendChild(audio);
        }
    };

    const playRemoteVideo = (stream, peerId, username) => {
        const grid = document.getElementById('video-grid');
        if (!grid) return;

        removeRemoteVideo(peerId);

        const container = document.createElement('div');
        container.id = `video-container-${peerId}`;
        container.className = `relative rounded-xl overflow-hidden border shadow-lg w-full md:w-auto max-w-2xl ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-black border-slate-300'}`;

        const video = document.createElement('video');
        video.id = `video-${peerId}`;
        video.srcObject = stream;
        video.autoplay = true;
        video.className = 'w-full h-auto max-h-[40vh] object-contain';

        const label = document.createElement('div');
        label.className = 'absolute bottom-3 left-3 bg-black/70 px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-md backdrop-blur-sm';
        label.innerText = `🖥️ ${username} Ekranı`;

        container.appendChild(video);
        container.appendChild(label);
        grid.appendChild(container);
    };

    const removeRemoteVideo = (peerId) => {
        const el = document.getElementById(`video-container-${peerId}`);
        if (el) el.remove();
    };

    // --- YENİ: KULLANICININ BİREYSEL SESİNİ KISIP AÇMA FONKSİYONU ---
    const changeUserVolume = (peerId, volumeValue) => {
        const audioEl = document.getElementById(`audio-${peerId}`);
        if (audioEl) {
            audioEl.volume = volumeValue; // 0.0 (Sessiz) ile 1.0 (En yüksek) arası
        }
    };

    const toggleMic = () => {
        if (localStream.current) {
            const audioTrack = localStream.current.getAudioTracks()[0];
            audioTrack.enabled = !audioTrack.enabled;
            setIsMicMuted(!audioTrack.enabled);
        }
    };

    const toggleDeafen = () => {
        const newState = !isDeafened;
        setIsDeafened(newState);
        document.querySelectorAll('audio').forEach(audio => { audio.muted = newState; });
    };

    const startScreenShare = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            screenStream.current = stream;
            setIsScreenSharing(true);

            voiceUsers.forEach(user => {
                const call = peerInstance.current.call(user.peerId, stream, {
                    metadata: { type: 'screen', username: profile?.kullanici_adi }
                });
                screenCalls.current[user.peerId] = call;
            });

            playRemoteVideo(stream, 'me', profile?.kullanici_adi || 'Ben');
            stream.getVideoTracks()[0].onended = () => stopScreenShare();
        } catch (err) {
            console.error("Ekran paylaşılamadı:", err);
        }
    };

    const stopScreenShare = () => {
        if (screenStream.current) {
            screenStream.current.getTracks().forEach(t => t.stop());
            screenStream.current = null;
        }
        setIsScreenSharing(false);
        removeRemoteVideo('me');
        Object.values(screenCalls.current).forEach(call => call.close());
        screenCalls.current = {};
    };

    const joinVoice = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStream.current = stream;
            setIsInVoice(true);
            setIsMicMuted(false);
            setIsDeafened(false);

            peer = new Peer();
            peerInstance.current = peer;

            peer.on('open', (id) => {
                socket.emit('join_voice', {
                    room: 'genel-ses',
                    peerId: id,
                    username: profile?.kullanici_adi || "Misafir"
                });
            });

            peer.on('call', (call) => {
                const type = call.metadata?.type;
                const callerUsername = call.metadata?.username || "Bağlı Kullanıcı";

                if (type === 'screen') {
                    call.answer();
                    call.on('stream', (remoteStream) => playRemoteVideo(remoteStream, call.peer, callerUsername));
                    call.on('close', () => removeRemoteVideo(call.peer));
                } else {
                    setVoiceUsers((prev) => {
                        if (!prev.some(u => u.peerId === call.peer)) {
                            return [...prev, { peerId: call.peer, username: callerUsername }];
                        }
                        return prev;
                    });
                    call.answer(stream);
                    call.on('stream', (remoteStream) => playRemoteStream(remoteStream, call.peer));
                }
            });

        } catch (err) {
            console.error(err);
            alert("Mikrofon izni alınamadı!");
        }
    };

    const leaveVoice = () => {
        if (screenStream.current) stopScreenShare();
        if (localStream.current) localStream.current.getTracks().forEach(t => t.stop());
        if (peerInstance.current) peerInstance.current.destroy();

        socket.emit('leave_voice', { room: 'genel-ses' });
        document.querySelectorAll('audio').forEach(audio => audio.remove());

        const grid = document.getElementById('video-grid');
        if (grid) grid.innerHTML = '';

        setIsInVoice(false);
        setVoiceUsers([]);
    };

    const sendMessage = (e) => {
        e.preventDefault()
        if (currentMessage.trim() === '') return

        const messageData = {
            sender: profile.kullanici_adi,
            text: currentMessage,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        }

        socket.emit('send_message', messageData)
        setChatMessages((prev) => {
            const updated = [...prev, messageData];
            localStorage.setItem('chat_history', JSON.stringify(updated));
            return updated;
        });
        setCurrentMessage('')
    }

    const handleLogout = () => {
        if (isInVoice) leaveVoice()
        localStorage.removeItem('aktif_kullanici')
        router.push('/')
    }

    if (loading) return <div className="flex h-screen bg-slate-950 items-center justify-center"><div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>

    return (
        <div className={`flex flex-col h-[100dvh] transition-colors duration-300 ${themeBg}`}>

            {/* MOBİL İÇİN ÜST HEADER */}
            <div className={`md:hidden flex items-center justify-between p-4 border-b z-20 ${cardBg}`}>
                <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-white shadow-md">
                        {profile?.kullanici_adi?.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-bold text-lg">{profile?.kullanici_adi}</span>
                </div>
                <div className="flex items-center space-x-2">
                    <button onClick={() => setIsDarkMode(!isDarkMode)} className={`p-2 rounded-full ${isDarkMode ? 'bg-slate-800 text-yellow-400' : 'bg-slate-200 text-slate-800'}`}>
                        {isDarkMode ? '☀️' : '🌙'}
                    </button>
                    <button onClick={handleLogout} className="p-2 text-red-500 rounded-full">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                    </button>
                </div>
            </div>

            {/* ANA TAŞIYICI */}
            <div className="flex flex-1 overflow-hidden">

                {/* MASAÜSTÜ SOL MENÜ */}
                <div className={`hidden md:flex flex-col w-72 border-r z-20 ${cardBg}`}>
                    <div className="p-6 border-b flex items-center justify-between transition-colors duration-300" style={{ borderColor: isDarkMode ? '#1e293b' : '#e2e8f0' }}>
                        <div className="flex items-center space-x-3">
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-white text-xl shadow-lg">
                                {profile?.kullanici_adi?.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h2 className="font-bold text-lg tracking-wide">{profile?.kullanici_adi}</h2>
                                <span className={`text-xs font-medium ${textMuted}`}>Çevrimiçi</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 p-4 space-y-2">
                        <button onClick={() => setActiveTab('chat')} className={`w-full flex items-center px-4 py-3 rounded-2xl transition-all font-medium ${activeTab === 'chat' ? 'bg-indigo-500/10 text-indigo-500' : `hover:bg-indigo-500/5 ${textMuted}`}`}>
                            <span className="text-xl mr-3">💬</span> Yazılı Sohbet
                        </button>
                        <button onClick={() => setActiveTab('voice')} className={`w-full flex items-center px-4 py-3 rounded-2xl transition-all font-medium ${activeTab === 'voice' ? 'bg-indigo-500/10 text-indigo-500' : `hover:bg-indigo-500/5 ${textMuted}`}`}>
                            <span className="text-xl mr-3">🎙️</span> Sesli Odalar
                        </button>
                    </div>

                    <div className="p-4 border-t flex justify-between items-center" style={{ borderColor: isDarkMode ? '#1e293b' : '#e2e8f0' }}>
                        <button onClick={() => setIsDarkMode(!isDarkMode)} className={`flex items-center justify-center p-3 rounded-xl transition-all w-12 ${isDarkMode ? 'bg-slate-800 hover:bg-slate-700 text-yellow-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-800'}`}>
                            {isDarkMode ? '☀️' : '🌙'}
                        </button>
                        <button onClick={handleLogout} className={`flex-1 ml-2 flex items-center justify-center p-3 rounded-xl transition-all font-medium ${isDarkMode ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400' : 'bg-red-50 hover:bg-red-100 text-red-500'}`}>
                            Çıkış Yap
                        </button>
                    </div>
                </div>

                {/* SAĞ İÇERİK ALANI */}
                <div className="flex-1 flex flex-col relative overflow-hidden">
                    {activeTab === 'chat' ? (
                        <>
                            <div className={`hidden md:flex h-16 border-b items-center px-6 absolute top-0 w-full z-10 ${cardBg}`}>
                                <h3 className="font-bold text-lg tracking-wide">Yazılı Sohbet</h3>
                            </div>

                            {/* MESAJ LİSTESİ */}
                            <div className="flex-1 overflow-y-auto p-4 md:p-6 md:pt-24 space-y-4 pb-24 md:pb-6">
                                {chatMessages.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center opacity-50">
                                        <span className="text-6xl mb-4">👋</span>
                                        <p className={textMuted}>Sohbeti başlatmak için bir şeyler yazın.</p>
                                    </div>
                                ) : (
                                    chatMessages.map((msg, index) => {
                                        const isMe = msg.sender === profile?.kullanici_adi;
                                        return (
                                            <div key={index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                                <span className={`text-[10px] mb-1 px-1 ${textMuted}`}>{msg.sender} • {msg.time}</span>
                                                <div className={`px-4 py-2.5 rounded-2xl max-w-[85%] md:max-w-[70%] text-sm md:text-base ${isMe ? 'bg-indigo-600 text-white rounded-br-sm' : `${bubbleOther} rounded-bl-sm border`}`}>
                                                    {msg.text}
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>

                            {/* MESAJ YAZMA ALANI */}
                            <div className={`absolute bottom-0 w-full p-3 md:p-4 border-t ${cardBg} mb-[70px] md:mb-0`}>
                                <form onSubmit={sendMessage} className="flex space-x-2 max-w-4xl mx-auto">
                                    <input
                                        type="text"
                                        placeholder="Bir mesaj yazın..."
                                        value={currentMessage}
                                        onChange={(e) => setCurrentMessage(e.target.value)}
                                        className={`flex-1 border px-5 py-3.5 rounded-full focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm md:text-base ${inputBg}`}
                                    />
                                    <button type="submit" className="w-12 h-12 md:w-14 md:h-14 flex-shrink-0 rounded-full bg-indigo-600 hover:bg-indigo-700 flex items-center justify-center text-white shadow-lg transition-all">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                    </button>
                                </form>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col p-4 md:p-8 relative overflow-y-auto mb-[70px] md:mb-0">

                            {/* EKRAN PAYLAŞIMI ALANI */}
                            <div id="video-grid" className="w-full flex flex-wrap justify-center gap-4 mb-6 empty:hidden z-10"></div>

                            <div className="z-10 w-full max-w-2xl mx-auto flex flex-col items-center mt-auto mb-auto">
                                {!isInVoice ? (
                                    <div className="text-center">
                                        <div className={`w-24 h-24 border rounded-3xl flex items-center justify-center mb-8 shadow-xl mx-auto rotate-3 ${cardBg}`}>
                                            <span className="text-5xl">🎙️</span>
                                        </div>
                                        <h2 className="text-2xl md:text-3xl font-bold mb-3">Sesli Bağlantı Odası</h2>
                                        <p className={`mb-10 max-w-md mx-auto leading-relaxed px-4 ${textMuted}`}>
                                            P2P şifreleme ile gecikmesiz sesli sohbet ve ekran paylaşımı.
                                        </p>
                                        <button onClick={joinVoice} className="w-full md:w-auto px-10 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-lg transition-all transform hover:-translate-y-1">
                                            Sese Katıl
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center w-full">
                                        <div className={`border p-5 md:p-6 rounded-3xl w-full max-w-md shadow-xl mb-6 ${cardBg}`}>
                                            <h3 className={`font-semibold mb-4 text-xs uppercase tracking-widest text-left ${textMuted}`}>
                                                Odada Bulunanlar ({voiceUsers.length + 1})
                                            </h3>

                                            <div className={`flex items-center justify-between border p-3 rounded-2xl mb-3 ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                                                <div className="flex items-center space-x-3 truncate">
                                                    <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-500 flex items-center justify-center font-bold flex-shrink-0">
                                                        {profile?.kullanici_adi?.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="font-medium truncate">{profile?.kullanici_adi}</span>
                                                </div>
                                                <div className="flex space-x-2 flex-shrink-0 ml-2">
                                                    {isMicMuted && <span className="px-2 py-1 bg-red-500/10 text-red-500 text-[10px] font-bold rounded-md">Susturuldu</span>}
                                                </div>
                                            </div>

                                            {/* YENİ: KULLANICILAR VE SES ÇUBUKLARI */}
                                            {voiceUsers.map((user, index) => (
                                                <div key={index} className={`flex items-center justify-between border p-3 rounded-2xl mt-2 ${isDarkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                                                    <div className="flex items-center space-x-3 truncate">
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDarkMode ? 'bg-slate-800 text-slate-500' : 'bg-slate-200 text-slate-500'}`}>
                                                            {user.username ? user.username.charAt(0).toUpperCase() : "🎧"}
                                                        </div>
                                                        <span className="font-medium truncate">{user.username || "Misafir"}</span>
                                                    </div>

                                                    {/* Ses Ayar Çubuğu (Slider) */}
                                                    <div className="flex items-center space-x-2 flex-shrink-0">
                                                        <span className="text-xs">🔊</span>
                                                        <input
                                                            type="range"
                                                            min="0"
                                                            max="1"
                                                            step="0.05"
                                                            defaultValue="1"
                                                            onChange={(e) => changeUserVolume(user.peerId, e.target.value)}
                                                            className="w-16 md:w-20 accent-indigo-500 cursor-pointer"
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex flex-wrap justify-center gap-3 w-full">
                                            <button onClick={toggleMic} className={`px-5 py-3 rounded-xl font-bold flex items-center transition-all text-sm ${isMicMuted ? 'bg-red-500 text-white' : (isDarkMode ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-800')}`}>
                                                {isMicMuted ? "🎙️ Sessiz" : "🎙️ Mikrofon"}
                                            </button>

                                            <button onClick={toggleDeafen} className={`px-5 py-3 rounded-xl font-bold flex items-center transition-all text-sm ${isDeafened ? 'bg-red-500 text-white' : (isDarkMode ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-800')}`}>
                                                {isDeafened ? "🎧 Sağır" : "🎧 Kulaklık"}
                                            </button>

                                            <button onClick={isScreenSharing ? stopScreenShare : startScreenShare} className={`w-full md:w-auto justify-center px-5 py-3 rounded-xl font-bold flex items-center transition-all text-sm ${isScreenSharing ? 'bg-indigo-600 text-white' : (isDarkMode ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-800')}`}>
                                                {isScreenSharing ? "🖥️ Yayını Durdur" : "🖥️ Ekran Paylaş"}
                                            </button>

                                            <button onClick={leaveVoice} className="w-full md:w-auto justify-center px-5 py-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white font-bold rounded-xl transition-all text-sm">
                                                Odadan Çık
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* MOBİL İÇİN ALT MENÜ */}
            <div className={`md:hidden fixed bottom-0 w-full flex justify-around items-center p-2 border-t pb-6 z-30 ${cardBg}`}>
                <button onClick={() => setActiveTab('chat')} className={`flex flex-col items-center p-2 rounded-xl w-20 transition-all ${activeTab === 'chat' ? 'text-indigo-500' : textMuted}`}>
                    <span className="text-2xl mb-1">💬</span>
                    <span className="text-[10px] font-bold">Sohbet</span>
                </button>
                <button onClick={() => setActiveTab('voice')} className={`flex flex-col items-center p-2 rounded-xl w-20 transition-all ${activeTab === 'voice' ? 'text-indigo-500' : textMuted}`}>
                    <span className="text-2xl mb-1">🎙️</span>
                    <span className="text-[10px] font-bold">Odalar</span>
                </button>
            </div>

        </div>
    )
}