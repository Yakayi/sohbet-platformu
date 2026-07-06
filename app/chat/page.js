'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { io } from 'socket.io-client'

// NOT: Canlıya aldığımızda buradaki URL'i Google Cloud adresimizle değiştireceğiz!
const socket = io('[https://proje-sesli-sohbet.onrender.com](https://proje-sesli-sohbet.onrender.com)');

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
}

export default function ChatDashboard() {
    const [profile, setProfile] = useState(null)
    const [loading, setLoading] = useState(true)

    const [chatMessages, setChatMessages] = useState([])
    const [currentMessage, setCurrentMessage] = useState('')
    const [activeTab, setActiveTab] = useState('chat')

    const [isInVoice, setIsInVoice] = useState(false)
    const [voiceUsers, setVoiceUsers] = useState([])

    const router = useRouter()
    const localStream = useRef(null)
    const peers = useRef({})
    const audioRefs = useRef({})

    useEffect(() => {
        checkUser()

        socket.on('receive_message', (data) => {
            setChatMessages((prev) => [...prev, data])
        })

        socket.on('user_joined_voice', async (newUserId) => {
            const pc = createPeerConnection(newUserId)
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            socket.emit('offer', { target: newUserId, caller: socket.id, sdp: offer })
        })

        socket.on('offer', async (payload) => {
            const pc = createPeerConnection(payload.caller)
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            socket.emit('answer', { target: payload.caller, caller: socket.id, sdp: answer })
        })

        socket.on('answer', async (payload) => {
            const pc = peers.current[payload.caller]
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
            }
        })

        socket.on('ice-candidate', (incoming) => {
            const pc = peers.current[incoming.caller]
            if (pc) {
                pc.addIceCandidate(new RTCIceCandidate(incoming.candidate)).catch(e => console.log(e))
            }
        })

        socket.on('user_left_voice', (userId) => {
            if (peers.current[userId]) {
                peers.current[userId].close()
                delete peers.current[userId]
            }
            setVoiceUsers((prev) => prev.filter((id) => id !== userId))
        })

        return () => {
            socket.off('receive_message')
            socket.off('user_joined_voice')
            socket.off('offer')
            socket.off('answer')
            socket.off('ice-candidate')
            socket.off('user_left_voice')
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

    const createPeerConnection = (targetUserId) => {
        const pc = new RTCPeerConnection(ICE_SERVERS)
        peers.current[targetUserId] = pc

        if (localStream.current) {
            localStream.current.getTracks().forEach((track) => {
                pc.addTrack(track, localStream.current)
            })
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { target: targetUserId, caller: socket.id, candidate: event.candidate })
            }
        }

        pc.ontrack = (event) => {
            setVoiceUsers((prev) => {
                if (!prev.includes(targetUserId)) return [...prev, targetUserId]
                return prev
            })

            let audio = audioRefs.current[targetUserId]
            if (!audio) {
                audio = new Audio()
                audio.autoplay = true
                audioRefs.current[targetUserId] = audio
            }
            audio.srcObject = event.streams[0]
        }

        return pc
    }

    const joinVoice = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            localStream.current = stream
            setIsInVoice(true)
            socket.emit('join_voice', 'genel-ses')
        } catch (err) {
            alert("Mikrofon izni alınamadı! Lütfen tarayıcı ayarlarından izin verin.")
        }
    }

    const leaveVoice = () => {
        Object.values(peers.current).forEach(pc => pc.close())
        peers.current = {}

        if (localStream.current) {
            localStream.current.getTracks().forEach(track => track.stop())
            localStream.current = null
        }

        setIsInVoice(false)
        setVoiceUsers([])
        socket.disconnect()
        setTimeout(() => socket.connect(), 500)
    }

    const sendMessage = (e) => {
        e.preventDefault()
        if (currentMessage.trim() === '') return

        const messageData = {
            sender: profile.kullanici_adi,
            text: currentMessage,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        }

        socket.emit('send_message', messageData)
        setChatMessages((prev) => [...prev, messageData])
        setCurrentMessage('')
    }

    const handleLogout = () => {
        if (isInVoice) leaveVoice()
        localStorage.removeItem('aktif_kullanici')
        router.push('/')
    }

    if (loading) {
        return (
            <div className="flex h-screen bg-slate-950 items-center justify-center">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        )
    }

    return (
        <div className="flex h-screen bg-slate-950 text-slate-200 font-sans p-4 space-x-4">

            {/* SOL MENÜ - Modern Card Tasarımı */}
            <div className="w-72 bg-slate-900 rounded-3xl flex flex-col shadow-2xl border border-slate-800 overflow-hidden">

                {/* Kullanıcı Profili Üst Kısım */}
                <div className="p-6 bg-gradient-to-br from-indigo-900/50 to-slate-900 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-white text-xl shadow-lg">
                            {profile?.kullanici_adi?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h2 className="font-bold text-white text-lg tracking-wide">{profile?.kullanici_adi}</h2>
                            <div className="flex items-center mt-1 space-x-1.5">
                                <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                                <span className="text-xs text-slate-400 font-medium">Çevrimiçi</span>
                            </div>
                        </div>
                    </div>
                    <button onClick={handleLogout} className="p-2 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-xl transition-all">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                    </button>
                </div>

                {/* Navigasyon Butonları */}
                <div className="flex-1 p-4 space-y-2">
                    <button
                        onClick={() => setActiveTab('chat')}
                        className={`w-full flex items-center px-4 py-3 rounded-2xl transition-all duration-300 font-medium ${activeTab === 'chat' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
                    >
                        <span className="text-xl mr-3">💬</span> Yazılı Sohbet
                    </button>

                    <button
                        onClick={() => setActiveTab('voice')}
                        className={`w-full flex items-center px-4 py-3 rounded-2xl transition-all duration-300 font-medium ${activeTab === 'voice' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
                    >
                        <span className="text-xl mr-3">🎙️</span> Sesli Odalar
                    </button>
                </div>
            </div>

            {/* SAĞ EKRAN - Ana İçerik Alanı */}
            <div className="flex-1 bg-slate-900 rounded-3xl shadow-2xl border border-slate-800 flex flex-col overflow-hidden relative">

                {activeTab === 'chat' ? (
                    <>
                        <div className="h-16 border-b border-slate-800/60 bg-slate-900/50 backdrop-blur-md flex items-center px-6 absolute top-0 w-full z-10">
                            <h3 className="font-bold text-white text-lg tracking-wide">Yazılı Sohbet</h3>
                        </div>

                        {/* Mesaj Baloncukları (iMessage/WhatsApp Tarzı) */}
                        <div className="flex-1 overflow-y-auto p-6 pt-24 space-y-4">
                            {chatMessages.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center opacity-50">
                                    <span className="text-6xl mb-4">👋</span>
                                    <p className="text-slate-400">Sohbeti başlatmak için bir şeyler yazın.</p>
                                </div>
                            ) : (
                                chatMessages.map((msg, index) => {
                                    const isMe = msg.sender === profile?.kullanici_adi;
                                    return (
                                        <div key={index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                            <span className="text-[10px] text-slate-500 mb-1 px-1">{msg.sender} • {msg.time}</span>
                                            <div className={`px-5 py-3 rounded-3xl max-w-[70%] shadow-md ${isMe ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-tr-sm' : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700'}`}>
                                                {msg.text}
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>

                        <div className="p-4 bg-slate-900 border-t border-slate-800">
                            <form onSubmit={sendMessage} className="flex space-x-2">
                                <input
                                    type="text"
                                    placeholder="Bir mesaj yazın..."
                                    value={currentMessage}
                                    onChange={(e) => setCurrentMessage(e.target.value)}
                                    className="flex-1 bg-slate-950 border border-slate-800 text-slate-200 px-6 py-4 rounded-full focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all shadow-inner"
                                />
                                <button type="submit" className="w-14 h-14 rounded-full bg-indigo-500 hover:bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 transition-all">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                </button>
                            </form>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center relative overflow-hidden">
                        {/* Arka plan dekoratif daireler */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>

                        <div className="z-10">
                            <div className="w-24 h-24 bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-3xl flex items-center justify-center mb-8 shadow-2xl mx-auto rotate-3">
                                <span className="text-4xl">🎙️</span>
                            </div>
                            <h2 className="text-3xl font-bold text-white mb-3">Sesli Bağlantı Odası</h2>
                            <p className="text-slate-400 mb-10 max-w-md mx-auto leading-relaxed">
                                P2P şifreleme ile doğrudan cihazlar arası gecikmesiz sesli sohbet deneyimi.
                            </p>

                            {!isInVoice ? (
                                <button onClick={joinVoice} className="px-10 py-4 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/20 transition-all transform hover:-translate-y-1">
                                    Mikrofonu Aç ve Katıl
                                </button>
                            ) : (
                                <div className="flex flex-col items-center w-full">

                                    <div className="bg-slate-950/50 border border-slate-800 p-6 rounded-3xl w-full max-w-md shadow-2xl backdrop-blur-sm mb-8">
                                        <h3 className="text-slate-400 font-semibold mb-4 text-sm uppercase tracking-widest text-left">
                                            Odada Bulunanlar ({voiceUsers.length + 1})
                                        </h3>

                                        <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-3 rounded-2xl mb-3">
                                            <div className="flex items-center space-x-3">
                                                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                                                    {profile?.kullanici_adi?.charAt(0).toUpperCase()}
                                                </div>
                                                <span className="text-white font-medium">{profile?.kullanici_adi}</span>
                                            </div>
                                            <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-bold rounded-full">SEN</span>
                                        </div>

                                        {voiceUsers.map((id, index) => (
                                            <div key={index} className="flex items-center space-x-3 bg-slate-900 border border-slate-800 p-3 rounded-2xl mb-2 animate-pulse">
                                                <div className="w-10 h-10 rounded-xl bg-slate-800 text-slate-500 flex items-center justify-center font-bold">
                                                    🎧
                                                </div>
                                                <span className="text-white font-medium">Bağlı Cihaz {index + 1}</span>
                                            </div>
                                        ))}
                                    </div>

                                    <button onClick={leaveVoice} className="px-10 py-4 bg-slate-800 hover:bg-red-500 text-slate-300 hover:text-white font-bold rounded-2xl shadow-lg transition-all border border-slate-700 hover:border-red-500">
                                        Bağlantıyı Kes
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}