import { jsPDF } from 'jspdf';
import { LOGO_BASE64 } from './constants/logo';
import { differenceInYears, parseISO } from 'date-fns';
import { useParams } from 'react-router-dom';
import React, { Component, createContext, useContext, useEffect, useState, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged, auth, db, doc, getDoc, setDoc, signOut, signInWithPopup, googleProvider, serverTimestamp, query, collection, onSnapshot, updateDoc, getDocs, deleteDoc } from './firebase';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  UserPlus, 
  Search, 
  LogIn, 
  LogOut, 
  Menu, 
  X, 
  GraduationCap, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  ChevronRight,
  Home as HomeIcon,
  Users,
  FileText,
  Download,
  Copy,
  Share2,
  Trash2
} from 'lucide-react';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends (Component as any) {
  constructor(props: any) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    const { hasError, error } = (this as any).state;
    if (hasError) {
      let message = "Terjadi kesalahan pada aplikasi.";
      try {
        const parsed = JSON.parse(error?.message || "{}");
        if (parsed.error && parsed.error.includes("permissions")) {
          message = "Akses ditolak. Anda tidak memiliki izin untuk melakukan operasi ini.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-gray-100 text-center">
            <div className="bg-red-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Ups! Terjadi Kesalahan</h2>
            <p className="text-gray-600 mb-8">{message}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

// --- Types ---
interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'user';
}

interface AuthContextType {
  user: any | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  loginError: string | null;
}

// --- Context ---
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// --- Auth Provider ---
const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const path = `users/${currentUser.uid}`;
        try {
          const docRef = doc(db, 'users', currentUser.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const existingProfile = docSnap.data() as UserProfile;
            const adminEmails = ["mahardikasandy1992@gmail.com", "barlimahardikasandy@gmail.com"];
            const userEmail = currentUser.email?.toLowerCase();
            const isAdminEmail = userEmail && adminEmails.includes(userEmail);
            
            if (isAdminEmail && existingProfile.role !== 'admin') {
              // Force update to admin if they are in the list but database says otherwise
              const updatedProfile = { ...existingProfile, role: 'admin' as const };
              await updateDoc(docRef, { role: 'admin' });
              setProfile(updatedProfile);
            } else {
              setProfile(existingProfile);
            }
          } else {
            // Default role for new users (except the bootstrapped admin)
            const adminEmails = ["mahardikasandy1992@gmail.com", "barlimahardikasandy@gmail.com"];
            const userEmail = currentUser.email?.toLowerCase();
            const isAdminEmail = userEmail && adminEmails.includes(userEmail);
            const newProfile: UserProfile = {
              uid: currentUser.uid,
              email: currentUser.email || '',
              role: isAdminEmail ? 'admin' : 'user'
            };
            await setDoc(docRef, newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, path);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const [loginError, setLoginError] = useState<string | null>(null);

  const login = async () => {
    setLoginError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login Error:", error);
      if (error.code === 'auth/unauthorized-domain') {
        setLoginError("Domain ini belum terdaftar di Firebase Console. Silakan tambahkan domain ini ke 'Authorized Domains' di Firebase.");
      } else {
        setLoginError(error.message || "Gagal login. Silakan coba lagi.");
      }
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const isAdmin = useMemo(() => {
    if (!user) return false;
    
    const adminEmails = ["mahardikasandy1992@gmail.com", "barlimahardikasandy@gmail.com"];
    const userEmail = user.email?.toLowerCase();
    const isExplicitAdmin = !!(userEmail && adminEmails.includes(userEmail));

    // Admin if they have the role OR if their email is in the hardcoded list
    const hasAdminPrivilege = profile?.role === 'admin' || isExplicitAdmin;

    // Hostname check (only for non-explicit admins)
    const isAllowedHost = 
      window.location.hostname === 'localhost' || 
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.includes('asia-southeast1.run.app') ||
      window.location.hostname.includes('vercel.app') ||
      isExplicitAdmin; // Explicit admins are allowed from any host

    return hasAdminPrivilege && isAllowedHost;
  }, [user, profile]);

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={{ user, profile, loading, isAdmin, login, logout, loginError }}>
        {children}
      </AuthContext.Provider>
    </ErrorBoundary>
  );
};

// --- Components ---

const Navbar = () => {
  const { user, profile, isAdmin, logout, login } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  const navItems = useMemo(() => {
    const items = [
      { name: 'Beranda', path: '/', icon: HomeIcon },
      { name: 'Pendaftaran', path: '/register', icon: UserPlus },
      { name: 'Cek Progres', path: '/progress', icon: Search },
    ];

    if (isAdmin) {
      items.push({ name: 'Admin Dashboard', path: '/admin', icon: LayoutDashboard });
    }
    return items;
  }, [isAdmin]);

  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link to="/" className="flex items-center gap-2">
              <div className="bg-emerald-600 p-2 rounded-lg">
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-gray-900 hidden sm:block">MDTA ABU DZAR</span>
            </Link>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center space-x-4">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                  location.pathname === item.path
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-emerald-600'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </Link>
            ))}
            
            {user ? (
              <div className="flex items-center gap-4 ml-4 pl-4 border-l border-gray-200">
                <div className="text-right hidden lg:block">
                  <p className="text-xs font-medium text-gray-900">{user.displayName}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">{profile?.role}</p>
                </div>
                <button
                  onClick={logout}
                  className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="ml-4 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                Login Admin
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="p-2 rounded-md text-gray-400 hover:text-emerald-600 hover:bg-gray-100 focus:outline-none"
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white border-b border-gray-100 overflow-hidden"
          >
            <div className="px-2 pt-2 pb-3 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsOpen(false)}
                  className={`block px-3 py-2 rounded-md text-base font-medium flex items-center gap-3 ${
                    location.pathname === item.path
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-emerald-600'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  {item.name}
                </Link>
              ))}
              {!user && (
                <Link
                  to="/login"
                  onClick={() => setIsOpen(false)}
                  className="block px-3 py-2 rounded-md text-base font-medium text-emerald-600 hover:bg-emerald-50 flex items-center gap-3"
                >
                  <LogIn className="w-5 h-5" />
                  Login Admin
                </Link>
              )}
              {user && (
                <button
                  onClick={() => { logout(); setIsOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-md text-base font-medium text-red-600 hover:bg-red-50 flex items-center gap-3"
                >
                  <LogOut className="w-5 h-5" />
                  Logout
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

const Footer = () => (
  <footer className="bg-white border-t border-gray-100 py-8 mt-auto">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-emerald-600" />
          <span className="font-semibold text-gray-900">MDTA ABU DZAR</span>
        </div>
        <p className="text-sm text-gray-500">
          &copy; {new Date().getFullYear()} Panitia Penerimaan Siswa Baru. All rights reserved.
        </p>
      </div>
    </div>
  </footer>
);

// --- Pages ---

const Home = () => {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'students'));
        setCount(snapshot.size);
      } catch (error) {
        console.error("Error fetching student count:", error);
      }
    };
    fetchCount();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 mb-6">
            Pendaftaran Tahun Ajaran 2026/2027
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight mb-6">
            Membangun Generasi <br />
            <span className="text-emerald-600">Berakhlak & Qur'ani</span>
          </h1>
          <p className="text-lg text-gray-600 mb-8 max-w-lg">
            Selamat datang di portal pendaftaran siswa baru MDTA ABU DZAR. Kami berkomitmen memberikan pendidikan agama terbaik untuk putra-putri Anda.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/register"
              className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center gap-2"
            >
              Daftar Sekarang
              <ChevronRight className="w-5 h-5" />
            </Link>
            <Link
              to="/progress"
              className="px-8 py-4 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold hover:bg-gray-50 transition-all flex items-center gap-2"
            >
              Cek Status
              <Search className="w-5 h-5" />
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative"
        >
          <div className="aspect-square rounded-3xl overflow-hidden shadow-2xl">
            <img
              src="https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa?auto=format&fit=crop&q=80&w=1000"
              alt="Beautiful Mosque"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "https://images.pexels.com/photos/2233416/pexels-photo-2233416.jpeg?auto=compress&cs=tinysrgb&w=1000";
              }}
            />
          </div>
          <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-2xl shadow-xl border border-gray-50 hidden sm:block">
            <div className="flex items-center gap-4">
              <div className="bg-emerald-100 p-3 rounded-xl">
                <Users className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{count !== null ? count : '...'}</p>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Siswa Terdaftar</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Features */}
      <div className="grid md:grid-cols-3 gap-8 mt-24">
        {[
          {
            title: 'Kurikulum Terpadu',
            desc: 'Kombinasi pendidikan agama dan pembentukan karakter yang kuat.',
            icon: GraduationCap,
            color: 'bg-blue-50 text-blue-600'
          },
          {
            title: 'Pengajar Berpengalaman',
            desc: 'Dibimbing oleh ustadz dan ustadzah yang kompeten di bidangnya.',
            icon: Users,
            color: 'bg-emerald-50 text-emerald-600'
          },
          {
            title: 'Fasilitas Nyaman',
            desc: 'Lingkungan belajar yang bersih, aman, dan kondusif.',
            icon: CheckCircle,
            color: 'bg-amber-50 text-amber-600'
          }
        ].map((feature, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.1 }}
            className="bg-white p-8 rounded-2xl border border-gray-100 hover:shadow-xl transition-shadow"
          >
            <div className={`${feature.color} w-12 h-12 rounded-xl flex items-center justify-center mb-6`}>
              <feature.icon className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">{feature.title}</h3>
            <p className="text-gray-600 leading-relaxed">{feature.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// --- Main App Component ---

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans selection:bg-emerald-100 selection:text-emerald-900">
          <Navbar />
          <main className="flex-grow">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
              <Route path="/success/:regId" element={<SuccessPage />} />
              <Route path="*" element={<div className="flex flex-col items-center justify-center h-screen text-center p-4">
                <AlertCircle className="w-16 h-16 text-emerald-600 mb-4" />
                <h2 className="text-2xl font-bold text-gray-900">Halaman Tidak Ditemukan</h2>
                <p className="text-gray-600 mt-2">Maaf, halaman yang Anda cari tidak tersedia.</p>
                <Link to="/" className="mt-6 px-6 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors">Kembali ke Beranda</Link>
              </div>} />
            </Routes>
          </main>
          <Footer />
        </div>
      </Router>
    </AuthProvider>
  );
}

// --- Helper Components & Pages ---

const LoginPage = () => {
  const { user, isAdmin, login, loading, loginError } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user && isAdmin) {
      navigate('/admin');
    }
  }, [user, isAdmin, loading, navigate]);

  if (loading) return <div className="flex items-center justify-center h-screen"><Clock className="animate-spin text-emerald-600" /></div>;

  return (
    <div className="max-w-md mx-auto px-4 py-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white p-8 rounded-3xl shadow-xl border border-gray-100 text-center"
      >
        <div className="bg-emerald-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <LogIn className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Login Panitia</h2>
        <p className="text-gray-600 mb-8">Silakan masuk menggunakan akun Google yang terdaftar sebagai panitia.</p>
        
        {loginError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 flex items-start gap-3 text-left">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>{loginError}</p>
          </div>
        )}
        
        {user ? (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800">
              <p className="font-bold">Akses Terbatas</p>
              <p>Akun <strong>{user.email}</strong> tidak memiliki akses admin.</p>
            </div>
            <button
              onClick={() => auth.signOut().then(() => login())}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
            >
              Ganti Akun
            </button>
          </div>
        ) : (
          <button
            onClick={login}
            className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
          >
            <LogIn className="w-5 h-5" />
            Login dengan Google
          </button>
        )}
        
        <Link to="/" className="block mt-6 text-sm text-gray-500 hover:underline">
          Kembali ke Beranda
        </Link>
      </motion.div>
    </div>
  );
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAdmin, loading, login } = useAuth();
  
  if (loading) return <div className="flex items-center justify-center h-screen"><Clock className="animate-spin text-emerald-600" /></div>;
  
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-center p-4">
        <LogIn className="w-16 h-16 text-emerald-600 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900">Login Diperlukan</h2>
        <p className="text-gray-600 mt-2">Silakan login dengan akun panitia untuk mengakses halaman ini.</p>
        <Link
          to="/login"
          className="mt-6 px-8 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center gap-2"
        >
          <LogIn className="w-5 h-5" />
          Ke Halaman Login
        </Link>
        <Link to="/" className="mt-4 text-gray-500 hover:underline text-sm">Kembali ke Beranda</Link>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-center p-4">
        <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900">Akses Ditolak</h2>
        <p className="text-gray-600 mt-2">Akun Anda ({user.email}) tidak memiliki hak akses sebagai panitia.</p>
        <p className="text-sm text-gray-500 mt-1 italic">Pastikan Anda menggunakan email yang terdaftar sebagai admin.</p>
        <div className="flex gap-4 mt-6">
          <Link to="/" className="px-6 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg font-medium hover:bg-gray-50 transition-colors">Beranda</Link>
          <button
            onClick={() => {
              // Sign out first to allow switching accounts
              auth.signOut().then(() => login());
            }}
            className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors"
          >
            Ganti Akun
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// --- Form Schema ---
const studentSchema = z.object({
  fullName: z.string().min(3, 'Nama lengkap minimal 3 karakter'),
  birthPlace: z.string().min(2, 'Tempat lahir minimal 2 karakter'),
  birthDate: z.string().min(1, 'Tanggal lahir harus diisi'),
  gender: z.enum(['Laki-laki', 'Perempuan']),
  sdClass: z.string().min(1, 'Kelas di SD harus dipilih'),
  parentName: z.string().min(3, 'Nama orang tua minimal 3 karakter'),
  phoneNumber: z.string().min(10, 'Nomor telepon minimal 10 digit'),
  address: z.string().min(5, 'Alamat minimal 5 karakter'),
});

type StudentFormValues = z.infer<typeof studentSchema>;

// --- Pages ---

const RegisterPage = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
  });

  const onSubmit = async (data: StudentFormValues) => {
    setIsSubmitting(true);
    const regId = `REG-${Math.floor(100000 + Math.random() * 900000)}`;
    const path = `students/${regId}`;
    try {
      const studentData = {
        ...data,
        registrationNumber: regId,
        status: 'pending',
        createdAt: serverTimestamp(),
      };
      
      await setDoc(doc(db, 'students', regId), studentData);
      navigate(`/success/${regId}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden"
      >
        <div className="bg-emerald-600 p-8 text-white">
          <h2 className="text-3xl font-bold mb-2">Formulir Pendaftaran</h2>
          <p className="text-emerald-100">Silakan lengkapi data calon siswa dengan benar.</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Nama Lengkap Calon Siswa</label>
              <input
                {...register('fullName')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none"
                placeholder="Contoh: Ahmad Abdullah"
              />
              {errors.fullName && <p className="text-xs text-red-500">{errors.fullName.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Jenis Kelamin</label>
              <select
                {...register('gender')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-white"
              >
                <option value="Laki-laki">Laki-laki</option>
                <option value="Perempuan">Perempuan</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Tempat Lahir</label>
              <input
                {...register('birthPlace')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none"
                placeholder="Contoh: Jakarta"
              />
              {errors.birthPlace && <p className="text-xs text-red-500">{errors.birthPlace.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Tanggal Lahir</label>
              <input
                type="date"
                {...register('birthDate')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none"
              />
              {errors.birthDate && <p className="text-xs text-red-500">{errors.birthDate.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Kelas di SD</label>
              <select
                {...register('sdClass')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-white"
              >
                <option value="">Pilih Kelas</option>
                <option value="Belum Sekolah">Belum Sekolah</option>
                <option value="Kelas 1">Kelas 1</option>
                <option value="Kelas 2">Kelas 2</option>
                <option value="Kelas 3">Kelas 3</option>
                <option value="Kelas 4">Kelas 4</option>
                <option value="Kelas 5">Kelas 5</option>
                <option value="Kelas 6">Kelas 6</option>
              </select>
              {errors.sdClass && <p className="text-xs text-red-500">{errors.sdClass.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Nama Orang Tua / Wali</label>
              <input
                {...register('parentName')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none"
                placeholder="Nama Ayah/Ibu"
              />
              {errors.parentName && <p className="text-xs text-red-500">{errors.parentName.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Nomor Telepon (WhatsApp)</label>
              <input
                {...register('phoneNumber')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none"
                placeholder="0812xxxxxxxx"
              />
              {errors.phoneNumber && <p className="text-xs text-red-500">{errors.phoneNumber.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700">Alamat Lengkap</label>
            <textarea
              {...register('address')}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none resize-none"
              placeholder="Alamat tempat tinggal sekarang"
            />
            {errors.address && <p className="text-xs text-red-500">{errors.address.message}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Clock className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
            Kirim Pendaftaran
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const SuccessPage = () => {
  const { regId } = useParams<{ regId: string }>();
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    if (!regId) return;
    navigator.clipboard.writeText(regId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareToWhatsApp = () => {
    const message = `Halo, saya baru saja mendaftar di MDTA ABU DZAR. Nomor Registrasi saya adalah: *${regId}*. Saya menyimpannya untuk mengecek progres pendaftaran nanti.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 text-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white p-8 sm:p-12 rounded-[2.5rem] shadow-2xl shadow-emerald-100 border border-emerald-50 relative overflow-hidden"
      >
        {/* Decorative background element */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full -mr-16 -mt-16 opacity-50" />
        
        <div className="w-24 h-24 bg-emerald-600 text-white rounded-3xl flex items-center justify-center mx-auto mb-8 rotate-3 shadow-lg shadow-emerald-200">
          <CheckCircle className="w-12 h-12" />
        </div>

        <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-4">Alhamdulillah, <br/><span className="text-emerald-600">Pendaftaran Berhasil!</span></h2>
        
        <div className="max-w-md mx-auto mb-10">
          <p className="text-gray-600 leading-relaxed">
            Data pendaftaran Anda telah masuk ke sistem kami. <span className="font-bold text-gray-900">PENTING:</span> Mohon simpan atau screenshot nomor registrasi di bawah ini agar tidak hilang.
          </p>
        </div>

        <div className="relative group mb-10">
          <div className="absolute inset-0 bg-emerald-600 blur-2xl opacity-10 group-hover:opacity-20 transition-opacity" />
          <div className="relative bg-white p-8 rounded-3xl border-2 border-dashed border-emerald-200 flex flex-col items-center justify-center">
            <p className="text-xs font-bold text-emerald-600 uppercase tracking-[0.2em] mb-3">Nomor Registrasi Anda</p>
            <p className="text-5xl sm:text-6xl font-black text-gray-900 tracking-tighter mb-6 font-mono">{regId}</p>
            
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={copyToClipboard}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${
                  copied 
                    ? 'bg-emerald-600 text-white scale-95' 
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                {copied ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                {copied ? 'Tersalin!' : 'Salin Nomor'}
              </button>
              
              <button
                onClick={shareToWhatsApp}
                className="flex items-center gap-2 px-6 py-3 bg-green-50 text-green-700 rounded-xl font-bold hover:bg-green-100 transition-all"
              >
                <Share2 className="w-5 h-5" />
                Simpan ke WA
              </button>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Link
            to="/progress"
            className="flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
          >
            <Search className="w-5 h-5" />
            Cek Progres
          </Link>
          <Link
            to="/"
            className="flex items-center justify-center gap-2 px-8 py-4 bg-gray-50 text-gray-600 rounded-2xl font-bold hover:bg-gray-100 transition-all"
          >
            <HomeIcon className="w-5 h-5" />
            Ke Beranda
          </Link>
        </div>

        <p className="mt-10 text-xs text-gray-400 italic">
          *Gunakan nomor ini untuk mengecek status penerimaan di halaman "Cek Progres".
        </p>
      </motion.div>
    </div>
  );
};

const ProgressPage = () => {
  const [regId, setRegId] = useState('');
  const [student, setStudent] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regId) return;
    
    setIsSearching(true);
    setError('');
    setStudent(null);
    
    const path = `students/${regId.toUpperCase()}`;
    try {
      const docRef = doc(db, 'students', regId.toUpperCase());
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        setStudent(docSnap.data());
      } else {
        setError('Nomor registrasi tidak ditemukan. Silakan cek kembali.');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">Cek Progres Pendaftaran</h2>
        <p className="text-gray-600">Masukkan nomor registrasi yang Anda dapatkan setelah mendaftar.</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-12">
        <input
          value={regId}
          onChange={(e) => setRegId(e.target.value)}
          placeholder="Masukkan Nomor Registrasi (Contoh: REG-123456)"
          className="flex-grow px-6 py-4 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none text-lg font-mono"
        />
        <button
          type="submit"
          disabled={isSearching}
          className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center gap-2"
        >
          {isSearching ? <Clock className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
          Cari
        </button>
      </form>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-6 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-4 text-red-700"
          >
            <AlertCircle className="w-6 h-6 flex-shrink-0" />
            <p>{error}</p>
          </motion.div>
        )}

        {student && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-8 rounded-3xl shadow-xl border border-gray-100"
          >
            <div className="flex justify-between items-start mb-8">
              <div>
                <p className="text-sm text-gray-500 uppercase tracking-wider mb-1">Status Pendaftaran</p>
                <div className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-bold gap-2 ${
                  student.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                  student.status === 'rejected' ? 'bg-red-100 text-red-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {student.status === 'accepted' ? <CheckCircle className="w-4 h-4" /> :
                   student.status === 'rejected' ? <X className="w-4 h-4" /> :
                   <Clock className="w-4 h-4" />}
                  {student.status === 'accepted' ? 'DITERIMA' :
                   student.status === 'rejected' ? 'TIDAK DITERIMA' :
                   'MENUNGGU PROSES'}
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500 uppercase tracking-wider mb-1">No. Registrasi</p>
                <p className="text-xl font-mono font-bold text-gray-900">{student.registrationNumber}</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 py-4 border-y border-gray-50">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Nama Calon Siswa</p>
                  <p className="font-semibold text-gray-900">{student.fullName}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Jenis Kelamin</p>
                  <p className="font-semibold text-gray-900">{student.gender}</p>
                </div>
              </div>

              {student.status === 'accepted' && (
                <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <h4 className="font-bold text-emerald-800 mb-2 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    Selamat! Anda Diterima
                  </h4>
                  <div className="text-sm text-emerald-700 leading-relaxed space-y-2">
                    <p>Silakan datang ke MDTA ABU DZAR pada jam kerja untuk melakukan daftar ulang dengan membawa berkas:</p>
                    <ul className="list-decimal list-inside ml-2">
                      <li>Fotokopi Akte Kelahiran</li>
                      <li>Fotokopi Kartu Keluarga</li>
                      <li>Pas foto 3x4 2 lembar dengan background merah</li>
                      <li>Surat Keterangan yang ditandatangani orang tua (Download di bawah)</li>
                    </ul>
                    <div className="pt-4">
                      <button
                        onClick={() => {
                          const doc = new jsPDF();
                          
                          // Logo
                          try {
                            doc.addImage(LOGO_BASE64, 'PNG', 20, 15, 30, 30);
                          } catch (e) {
                            console.error('Error adding logo to PDF:', e);
                          }
                          
                          // Header (Matching the provided image)
                          doc.setFont('helvetica', 'bold');
                          doc.setFontSize(14);
                          doc.text('YAYASAN ABU DZAR AL-GHIFFARY', 110, 20, { align: 'center' });
                          
                          doc.setFontSize(12);
                          doc.text('MADRASAH DINIYAH TAKMILIYAH AWALIYAH', 110, 27, { align: 'center' });
                          
                          doc.setFontSize(22);
                          doc.text('ABU DZAR', 110, 38, { align: 'center' });
                          
                          doc.setFont('helvetica', 'normal');
                          doc.setFontSize(10);
                          doc.text('Alamat: Jl. Raya Serang Km. 3 Komp. Cigadung Mandiri RT 01/10.', 110, 45, { align: 'center' });
                          doc.text('Email: mdta.abudzar@gmail.com', 110, 50, { align: 'center' });
                          
                          // Double Line Separator
                          doc.setLineWidth(0.8);
                          doc.line(20, 54, 190, 54);
                          doc.setLineWidth(0.2);
                          doc.line(20, 56, 190, 56);

                          // Narrative
                          doc.setFontSize(11);
                          doc.setFont('helvetica', 'bold');
                          doc.text('SURAT KETERANGAN DITERIMA', 105, 68, { align: 'center' });
                          
                          doc.setFont('helvetica', 'normal');
                          const narrative = `Berdasarkan hasil verifikasi data pendaftaran, dengan ini Panitia Penerimaan Siswa Baru MDTA ABU DZAR menyatakan bahwa calon siswa di bawah ini:`;
                          const splitNarrative = doc.splitTextToSize(narrative, 170);
                          doc.text(splitNarrative, 20, 78);

                          doc.setFont('helvetica', 'bold');
                          doc.text('DITERIMA', 105, 88, { align: 'center' });
                          doc.setFont('helvetica', 'normal');

                          // Student Data
                          let y = 100;
                          const labels = [
                            ['No. Registrasi', student.registrationNumber],
                            ['Nama Lengkap', student.fullName],
                            ['Jenis Kelamin', student.gender],
                            ['Tempat, Tgl Lahir', `${student.birthPlace}, ${student.birthDate}`],
                            ['Kelas di SD', student.sdClass],
                            ['Nama Orang Tua', student.parentName],
                            ['Nomor Telepon', student.phoneNumber],
                            ['Alamat', student.address]
                          ];

                          labels.forEach(([label, value]) => {
                            doc.setFont('helvetica', 'bold');
                            doc.text(`${label}`, 25, y);
                            doc.text(':', 65, y);
                            doc.setFont('helvetica', 'normal');
                            const splitValue = doc.splitTextToSize(value, 115);
                            doc.text(splitValue, 70, y);
                            y += (splitValue.length * 6);
                          });

                          // Photo Box
                          y += 10;
                          doc.setLineWidth(0.2);
                          doc.rect(25, y, 30, 40); // 3x4 ratio
                          doc.setFontSize(8);
                          doc.text('Foto 3x4', 40, y + 20, { align: 'center' });

                          // Signature
                          doc.setFontSize(11);
                          const today = new Date().toLocaleDateString('id-ID', { 
                            day: 'numeric', 
                            month: 'long', 
                            year: 'numeric' 
                          });
                          doc.text(`Dicetak pada: ${today}`, 130, y);
                          doc.text('Tanda Tangan Orang Tua/Wali', 130, y + 10);
                          doc.line(130, y + 40, 185, y + 40);
                          doc.text(`( ${student.parentName} )`, 130, y + 45);

                          // Footer Info
                          doc.setFontSize(9);
                          doc.setFont('helvetica', 'italic');
                          const footer = '*Surat ini adalah bukti pendaftaran online yang sah. Silakan bawa surat ini saat melakukan daftar ulang ke kantor MDTA ABU DZAR.';
                          doc.text(doc.splitTextToSize(footer, 170), 20, 280);

                          doc.save(`Surat_Diterima_${student.registrationNumber}.pdf`);
                        }}
                        className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                      >
                        <Download className="w-5 h-5" />
                        Download Surat Keterangan (PDF)
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {student.status === 'pending' && (
                <div className="p-6 bg-amber-50 rounded-2xl border border-amber-100">
                  <h4 className="font-bold text-amber-800 mb-2 flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Sedang Diproses
                  </h4>
                  <p className="text-sm text-amber-700 leading-relaxed">
                    Pendaftaran Anda telah berhasil diterima dan saat ini sedang dalam proses verifikasi. Mohon menunggu, kami akan segera memberikan informasi lanjutan.
                  </p>
                </div>
              )}

              {student.status === 'rejected' && (
                <div className="p-6 bg-red-50 rounded-2xl border border-red-100">
                  <h4 className="font-bold text-red-800 mb-2 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    Mohon Maaf
                  </h4>
                  <p className="text-sm text-red-700 leading-relaxed">
                    Pendaftaran Anda belum dapat kami terima untuk saat ini. Terima kasih atas minat Anda untuk mendaftarkan putra/putri-nya pada MDTA ABU DZAR.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AdminDashboard = () => {
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const path = 'students';
    const q = query(collection(db, path));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStudents(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return unsubscribe;
  }, []);

  const updateStatus = async (id: string, status: string) => {
    const path = `students/${id}`;
    try {
      await updateDoc(doc(db, 'students', id), { status });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const deleteStudent = async (id: string) => {
    const path = `students/${id}`;
    try {
      await deleteDoc(doc(db, 'students', id));
      setDeletingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const filteredStudents = students.filter(s => filter === 'all' || s.status === filter);

  const downloadData = () => {
    if (students.length === 0) return;

    const headers = [
      'No. Registrasi',
      'Nama Lengkap',
      'Tempat Lahir',
      'Tanggal Lahir',
      'Jenis Kelamin',
      'Kelas SD',
      'Nama Orang Tua',
      'Nomor Telepon',
      'Alamat',
      'Status',
      'Tanggal Daftar'
    ];

    const csvRows = [
      headers.join(','),
      ...students.map(s => {
        const createdAt = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString() : '';
        return [
          `"${s.registrationNumber}"`,
          `"${s.fullName}"`,
          `"${s.birthPlace}"`,
          `"${s.birthDate}"`,
          `"${s.gender}"`,
          `"${s.sdClass || '-'}"`,
          `"${s.parentName}"`,
          `"${s.phoneNumber}"`,
          `"${s.address.replace(/"/g, '""')}"`,
          `"${s.status}"`,
          `"${createdAt}"`
        ].join(',');
      })
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `data_siswa_psb_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const stats = {
    total: students.length,
    pending: students.filter(s => s.status === 'pending').length,
    accepted: students.filter(s => s.status === 'accepted').length,
    rejected: students.filter(s => s.status === 'rejected').length,
    male: students.filter(s => s.gender === 'Laki-laki').length,
    female: students.filter(s => s.gender === 'Perempuan').length,
  };

  const calculateAge = (birthDate: string) => {
    try {
      return differenceInYears(new Date(), parseISO(birthDate));
    } catch (e) {
      return '-';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Dashboard Panitia</h2>
          <p className="text-gray-500">Kelola pendaftaran siswa baru MDTA ABU DZAR.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadData}
            className="px-4 py-2 bg-white text-emerald-600 border border-emerald-200 rounded-lg text-sm font-medium hover:bg-emerald-50 transition-all flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download Data
          </button>
          {['all', 'pending', 'accepted', 'rejected'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                filter === f ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {f === 'all' ? 'Semua' : f === 'pending' ? 'Menunggu' : f === 'accepted' ? 'Diterima' : 'Ditolak'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[
          { label: 'Total Pendaftar', value: stats.total, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Menunggu', value: stats.pending, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Diterima', value: stats.accepted, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Ditolak', value: stats.rejected, icon: X, color: 'text-red-600', bg: 'bg-red-50' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`${stat.bg} ${stat.color} p-3 rounded-xl`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <span className="text-3xl font-bold text-gray-900">{stat.value}</span>
            </div>
            <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Gender Summary */}
      <div className="flex gap-4 mb-10">
        <div className="bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 flex items-center gap-2">
          <span className="text-blue-600 font-bold">{stats.male}</span>
          <span className="text-xs text-blue-700 font-medium uppercase tracking-wider">Laki-laki</span>
        </div>
        <div className="bg-pink-50 px-4 py-2 rounded-xl border border-pink-100 flex items-center gap-2">
          <span className="text-pink-600 font-bold">{stats.female}</span>
          <span className="text-xs text-pink-700 font-medium uppercase tracking-wider">Perempuan</span>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">No. Reg</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Nama Siswa</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Gender</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Kelas SD</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Usia</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Orang Tua</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Telepon</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <Clock className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-2" />
                    <p className="text-gray-500">Memuat data...</p>
                  </td>
                </tr>
              ) : filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    Tidak ada data pendaftaran.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-emerald-700">{s.registrationNumber}</td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-gray-900">{s.fullName}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                        s.gender === 'Laki-laki' ? 'bg-blue-50 text-blue-600' : 'bg-pink-50 text-pink-600'
                      }`}>
                        {s.gender}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600 font-medium">{s.sdClass || '-'}</td>
                    <td className="px-6 py-4 text-gray-600 font-medium">{calculateAge(s.birthDate)} Tahun</td>
                    <td className="px-6 py-4 text-gray-600">{s.parentName}</td>
                    <td className="px-6 py-4 text-gray-600">{s.phoneNumber}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        s.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                        s.status === 'rejected' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateStatus(s.id, 'accepted')}
                          className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Terima"
                        >
                          <CheckCircle className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => updateStatus(s.id, 'rejected')}
                          className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          title="Tolak"
                        >
                          <X className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => setDeletingId(s.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Hapus"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingId && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-gray-100"
            >
              <div className="bg-red-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 text-center mb-2">Hapus Data?</h3>
              <p className="text-gray-600 text-center mb-8">
                Tindakan ini tidak dapat dibatalkan. Seluruh data pendaftaran siswa ini akan dihapus permanen.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingId(null)}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all"
                >
                  Batal
                </button>
                <button
                  onClick={() => deleteStudent(deletingId)}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-100"
                >
                  Ya, Hapus
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
