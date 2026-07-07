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

    const router = useRouter()
    const localStream = useRef(null)
    const screenStream = useRef(null)
    const peerInstance = useRef(null)
    const screenCalls = useRef({}) // Ekran paylaşımı çağrılarını tutmak için

    // --- SİSTEM BAŞLANGICI VE SOHBET GEÇMİŞİ KONTROLÜ ---
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
                // 1. Yeni geleni SES için ara
                const audioCall = peerInstance.current.call(data.peerId, localStream.current, {
                    metadata: { type: 'audio', username: JSON.parse(localStorage.getItem('aktif_kullanici'))?.kullanici_adi }
                });
                audioCall.on('stream', (remoteStream) => playRemoteStream(remoteStream, data.peerId));

                // 2. Eğer ekran paylaşıyorsak, yeni geleni EKRAN için de ara
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
            removeRemoteVideo(peerId); // Çıkanın ekranını da kapat
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

    // --- SES OYNATICI YARDIMCISI ---
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

    // --- VİDEO (EKRAN) OYNATICI YARDIMCISI ---
    const playRemoteVideo = (stream, peerId, username) => {
        const grid = document.getElementById('video-grid');
        if (!grid) return;

        removeRemoteVideo(peerId); // Varsa eskisini sil

        const container = document.createElement('div');
        container.id = `video-container-${peerId}`;
        container.className = 'relative bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-lg w-full md:w-auto max-w-2xl';

        const video = document.createElement('video');
        video.id = `video-${peerId}`;
        video.srcObject = stream;
        video.autoplay = true;
        video.className = 'w-full h-auto max-h-[50vh] object-contain';

        const label = document.createElement('div');
        label.className = 'absolute bottom-3 left-3 bg-slate-900/80 px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-md backdrop-blur-sm';
        label.innerText = `🖥️ ${username} Ekranı`;

        container.appendChild(video);
        container.appendChild(label);
        grid.appendChild(container);
    };

    const removeRemoteVideo = (peerId) => {
        const el = document.getElementById(`video-container-${peerId}`);
        if (el) el.remove();
    };

    // --- SES VE EKRAN KONTROLLERİ ---
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

            // Odadaki herkese ekranımızı yolluyoruz
            voiceUsers.forEach(user => {
                const call = peerInstance.current.call(user.peerId, stream, {
                    metadata: { type: 'screen', username: profile?.kullanici_adi }
                });
                screenCalls.current[user.peerId] = call;
            });

            // Kendi ekranımızı da UI'da görelim
            playRemoteVideo(stream, 'me', profile?.kullanici_adi || 'Ben');

            // Tarayıcının "Paylaşımı Durdur" butonuna basılırsa
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

        // Diğerlerine giden ekran çağrılarını kapat
        Object.values(screenCalls.current).forEach(call => call.close());
        screenCalls.current = {};
    };

    // --- SESE KATILMA VE DİNLEME ---
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

            // Biri bizi aradığında (Ses veya Ekran)
            peer.on('call', (call) => {
                const type = call.metadata?.type;
                const callerUsername = call.metadata?.username || "Bağlı Kullanıcı";

                if (type === 'screen') {
                    // Ekran paylaşımı çağrısıysa sessizce kabul et
                    call.answer();
                    call.on('stream', (remoteStream) => playRemoteVideo(remoteStream, call.peer, callerUsername));
                    call.on('close', () => removeRemoteVideo(call.peer));
                } else {
                    // Normal Ses çağrısıysa listeye ekle ve sesi aç
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

    // --- SESTEN ÇIKMA ---
    const leaveVoice = () => {
        if (screenStream.current) stopScreenShare();
        if (localStream.current) localStream.current.getTracks().forEach(t => t.stop());
        if (peerInstance.current) peerInstance.current.destroy();

        socket.emit('leave_voice', { room: 'genel-ses' });
        document.querySelectorAll('audio').forEach(audio => audio.remove());

        const grid = document.getElementById('video-grid');
        if (grid) grid.innerHTML = ''; // Ekranları temizle

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
        // MOBİL UYUMLU ANA TAŞIYICI (flex-col md:flex-row)
        <div className="flex flex-col md:flex-row h-[100dvh] bg-slate-950 text-slate-200 font-sans p-2 md:p-4 gap-2 md:gap-4 overflow-hidden">

            {/* SOL MENÜ - Mobilde üstte yatarak duracak, PC'de solda dik duracak */}
            <div className="w-full md:w-72 bg-slate-900 rounded-2xl md:rounded-3xl flex flex-col shadow-2xl border border-slate-800 flex-shrink-0 z-20">
                <div className="p-4 md:p-6 bg-gradient-to-br from-indigo-900/50 to-slate-900 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-white text-lg md:text-xl shadow-lg">
                            {profile?.kullanici_adi?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h2 className="font-bold text-white text-base md:text-lg tracking-wide">{profile?.kullanici_adi}</h2>
                            <div className="flex items-center mt-0.5 md:mt-1 space-x-1.5">
                                <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                                <span className="text-[10px] md:text-xs text-slate-400 font-medium">Çevrimiçi</span>
                            </div>
                        </div>
                    </div>
                    <button onClick={handleLogout} className="p-2 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-xl transition-all">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                    </button>
                </div>

                <div className="p-2 md:p-4 flex flex-row md:flex-col gap-2 overflow-x-auto">
                    <button onClick={() => setActiveTab('chat')} className={`flex-1 md:w-full flex items-center justify-center md:justify-start px-4 py-3 rounded-2xl transition-all duration-300 font-medium text-sm md:text-base whitespace-nowrap ${activeTab === 'chat' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
                        <span className="text-lg md:text-xl mr-2 md:mr-3">💬</span> Yazılı Sohbet
                    </button>
                    <button onClick={() => setActiveTab('voice')} className={`flex-1 md:w-full flex items-center justify-center md:justify-start px-4 py-3 rounded-2xl transition-all duration-300 font-medium text-sm md:text-base whitespace-nowrap ${activeTab === 'voice' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
                        <span className="text-lg md:text-xl mr-2 md:mr-3">🎙️</span> Sesli Odalar
                    </button>
                </div>
            </div>

            {/* SAĞ EKRAN - Ana İçerik */}
            <div className="flex-1 bg-slate-900 rounded-2xl md:rounded-3xl shadow-2xl border border-slate-800 flex flex-col overflow-hidden relative z-10">

                {activeTab === 'chat' ? (
                    <>
                        <div className="h-14 md:h-16 border-b border-slate-800/60 bg-slate-900/50 backdrop-blur-md flex items-center px-4 md:px-6 absolute top-0 w-full z-10">
                            <h3 className="font-bold text-white text-base md:text-lg tracking-wide">Yazılı Sohbet</h3>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 md:p-6 pt-20 md:pt-24 space-y-4">
                            {chatMessages.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center opacity-50">
                                    <span className="text-5xl md:text-6xl mb-4">👋</span>
                                    <p className="text-sm md:text-base text-slate-400">Sohbeti başlatmak için bir şeyler yazın.</p>
                                </div>
                            ) : (
                                chatMessages.map((msg, index) => {
                                    const isMe = msg.sender === profile?.kullanici_adi;
                                    return (
                                        <div key={index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                            <span className="text-[10px] text-slate-500 mb-1 px-1">{msg.sender} • {msg.time}</span>
                                            <div className={`px-4 md:px-5 py-2 md:py-3 rounded-2xl md:rounded-3xl max-w-[85%] md:max-w-[70%] shadow-md text-sm md:text-base ${isMe ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-tr-sm' : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700'}`}>
                                                {msg.text}
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>

                        <div className="p-3 md:p-4 bg-slate-900 border-t border-slate-800">
                            <form onSubmit={sendMessage} className="flex space-x-2">
                                <input
                                    type="text"
                                    placeholder="Bir mesaj yazın..."
                                    value={currentMessage}
                                    onChange={(e) => setCurrentMessage(e.target.value)}
                                    className="flex-1 bg-slate-950 border border-slate-800 text-slate-200 px-4 md:px-6 py-3 md:py-4 rounded-full focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner text-sm md:text-base"
                                />
                                <button type="submit" className="w-12 h-12 md:w-14 md:h-14 flex-shrink-0 rounded-full bg-indigo-500 hover:bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 transition-all">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                </button>
                            </form>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col p-4 md:p-8 relative overflow-y-auto overflow-x-hidden scroll-smooth">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] md:w-[500px] h-[300px] md:h-[500px] bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>

                        {/* EKRAN PAYLAŞIMI VİDEOLARI BURAYA GELECEK */}
                        <div id="video-grid" className="w-full flex flex-wrap justify-center gap-4 mb-6 empty:hidden z-10"></div>

                        <div className="z-10 w-full max-w-2xl mx-auto flex flex-col items-center mt-auto mb-auto">
                            {!isInVoice ? (
                                <div className="text-center">
                                    <div className="w-20 h-20 md:w-24 md:h-24 bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-3xl flex items-center justify-center mb-6 md:mb-8 shadow-2xl mx-auto rotate-3">
                                        <span className="text-3xl md:text-4xl">🎙️</span>
                                    </div>
                                    <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">Sesli Bağlantı Odası</h2>
                                    <p className="text-sm md:text-base text-slate-400 mb-8 md:mb-10 max-w-md mx-auto leading-relaxed px-4">
                                        P2P şifreleme ile doğrudan cihazlar arası gecikmesiz sesli sohbet deneyimi.
                                    </p>
                                    <button onClick={joinVoice} className="w-full md:w-auto px-8 md:px-10 py-3.5 md:py-4 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 transition-all transform hover:-translate-y-1 text-sm md:text-base">
                                        Mikrofonu Aç ve Katıl
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center w-full">
                                    <div className="bg-slate-950/50 border border-slate-800 p-4 md:p-6 rounded-3xl w-full max-w-md shadow-2xl backdrop-blur-sm mb-6">
                                        <h3 className="text-slate-400 font-semibold mb-4 text-xs md:text-sm uppercase tracking-widest text-left">
                                            Odada Bulunanlar ({voiceUsers.length + 1})
                                        </h3>

                                        <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-3 rounded-2xl mb-3">
                                            <div className="flex items-center space-x-3 truncate">
                                                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold flex-shrink-0">
                                                    {profile?.kullanici_adi?.charAt(0).toUpperCase()}
                                                </div>
                                                <span className="text-white font-medium truncate text-sm md:text-base">{profile?.kullanici_adi}</span>
                                            </div>
                                            <div className="flex space-x-2 flex-shrink-0 ml-2">
                                                {isMicMuted && <span className="px-2 py-1 bg-red-500/20 text-red-400 text-[10px] md:text-xs font-bold rounded-md hidden md:inline-block">Susturuldu</span>}
                                                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] md:text-xs font-bold rounded-full">SEN</span>
                                            </div>
                                        </div>

                                        {voiceUsers.map((user, index) => (
                                            <div key={index} className="flex items-center space-x-3 bg-slate-900 border border-slate-800 p-3 rounded-2xl mt-2">
                                                <div className="w-10 h-10 rounded-xl bg-slate-800 text-slate-500 flex items-center justify-center flex-shrink-0">
                                                    {user.username ? user.username.charAt(0).toUpperCase() : "🎧"}
                                                </div>
                                                <span className="text-white font-medium truncate text-sm md:text-base">{user.username || "Misafir"}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* KONTROL PANELİ EKRAN PAYLAŞIMI İLE GÜNCELLENDİ */}
                                    <div className="flex flex-wrap justify-center gap-2 md:gap-4 w-full px-2">
                                        <button onClick={toggleMic} className={`flex-1 md:flex-none justify-center px-4 md:px-6 py-3 rounded-2xl font-bold flex items-center transition-all text-xs md:text-sm ${isMicMuted ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
                                            {isMicMuted ? "🎙️ Sessiz" : "🎙️ Mikrofon"}
                                        </button>

                                        <button onClick={toggleDeafen} className={`flex-1 md:flex-none justify-center px-4 md:px-6 py-3 rounded-2xl font-bold flex items-center transition-all text-xs md:text-sm ${isDeafened ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
                                            {isDeafened ? "🎧 Sağır" : "🎧 Kulaklık"}
                                        </button>

                                        <button onClick={isScreenSharing ? stopScreenShare : startScreenShare} className={`w-full md:w-auto justify-center px-4 md:px-6 py-3 rounded-2xl font-bold flex items-center transition-all text-xs md:text-sm ${isScreenSharing ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}>
                                            {isScreenSharing ? "🖥️ Yayını Durdur" : "🖥️ Ekran Paylaş"}
                                        </button>

                                        <button onClick={leaveVoice} className="w-full md:w-auto justify-center px-4 md:px-6 py-3 bg-red-600/20 hover:bg-red-600 text-red-500 hover:text-white font-bold rounded-2xl border border-red-500/30 hover:border-red-600 transition-all text-xs md:text-sm">
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
    )
}