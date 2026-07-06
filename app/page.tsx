'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabaseClient'

export default function Home() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [kullaniciAdi, setKullaniciAdi] = useState('')
  const [isLogin, setIsLogin] = useState(true)
  const [message, setMessage] = useState('')
  const router = useRouter()

  const handleAuth = async (e: any) => {
    e.preventDefault()
    setMessage('İşlem yapılıyor...')

    if (isLogin) {
      // GİRİŞ YAP
      const { data, error } = await supabase
        .from('kullanicilar')
        .select('*')
        .eq('email', email)
        .eq('sifre', password)
        .single()

      if (error || !data) {
        setMessage('E-posta veya şifre hatalı!')
      } else {
        setMessage('Giriş başarılı! Yönlendiriliyorsunuz...')
        localStorage.setItem('aktif_kullanici', JSON.stringify(data))
        router.push('/chat')
      }
    } else {
      // KAYIT OL
      if (!kullaniciAdi.trim()) {
        setMessage('Lütfen bir kullanıcı adı girin.')
        return
      }

      const { error } = await supabase
        .from('kullanicilar')
        .insert([{ email: email, sifre: password, kullanici_adi: kullaniciAdi }])

      if (error) {
        setMessage(`Hata: ${error.message}`) // Gerçek hatayı ekrana yazdırır
      } else {
        setMessage('Kayıt başarılı! Şimdi giriş yapabilirsiniz.')
        setIsLogin(true)
        setPassword('')
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
      <div className="w-full max-w-md p-8 bg-gray-800 rounded-lg shadow-lg">
        <h2 className="text-3xl font-bold text-center mb-6">
          {isLogin ? 'Tekrar Hoş Geldin!' : 'Yeni Hesap Aç'}
        </h2>

        <form onSubmit={handleAuth} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium mb-1">Kullanıcı Adı</label>
              <input
                type="text"
                value={kullaniciAdi}
                onChange={(e) => setKullaniciAdi(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
                required={!isLogin}
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">E-Posta</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Şifre</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded font-bold transition-colors"
          >
            {isLogin ? 'Giriş Yap' : 'Kayıt Ol'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-400">
          {isLogin ? "Hesabın yok mu? " : "Zaten hesabın var mı? "}
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-blue-500 hover:underline font-bold"
          >
            {isLogin ? 'Kayıt Ol' : 'Giriş Yap'}
          </button>
        </p>

        {message && (
          <div className="mt-4 p-3 bg-gray-700 border border-gray-600 rounded text-center text-sm text-yellow-400">
            {message}
          </div>
        )}
      </div>
    </div>
  )
}