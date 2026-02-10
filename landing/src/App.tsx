import { useEffect, useRef, useLayoutEffect, useState } from 'react';
import { animate, stagger, utils } from 'animejs';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Set initial hidden states before paint
  useLayoutEffect(() => {
    // Hide elements initially for animation
    const setInitialStyles = (selector: string, styles: Partial<CSSStyleDeclaration>) => {
      document.querySelectorAll(selector).forEach(el => {
        Object.assign((el as HTMLElement).style, styles);
      });
    };

    setInitialStyles('.logo-icon', { transform: 'scale(0) rotate(45deg)' });
    // Skip title - To make it visible for now
    setInitialStyles('.subtitle', { opacity: '0', transform: 'translateY(20px)' });
    setInitialStyles('.coming-soon .word', { opacity: '0', transform: 'translateY(30px) scale(0.8)' });
    setInitialStyles('.divider', { transform: 'scaleX(0)' });
    setInitialStyles('.description', { opacity: '0', transform: 'translateY(20px)' });
    setInitialStyles('.notify-form', { opacity: '0', transform: 'translateY(30px)' });
  }, []);

  useEffect(() => {
    // Animate the logo
    animate('.logo-icon', {
      scale: 1,
      rotate: 0,
      duration: 1200,
      ease: 'outElastic(1, 0.5)',
    });

    

    // Animate the subtitle
    animate('.subtitle', {
      opacity: 1,
      translateY: 0,
      duration: 1000,
      delay: 800,
      ease: 'outExpo',
    });

    // Animate "Coming Soon" text
    animate('.coming-soon .word', {
      opacity: 1,
      translateY: 0,
      scale: 1,
      duration: 1000,
      delay: stagger(150, { start: 1000 }),
      ease: 'outExpo',
    });

    // Animate the divider line
    animate('.divider', {
      scaleX: 1,
      duration: 1200,
      delay: 1400,
      ease: 'outExpo',
    });

    // Animate the description
    animate('.description', {
      opacity: 1,
      translateY: 0,
      duration: 1000,
      delay: 1600,
      ease: 'outExpo',
    });

    // Animate email form
    animate('.notify-form', {
      opacity: 1,
      translateY: 0,
      duration: 1000,
      delay: 1800,
      ease: 'outExpo',
    });

    // Create floating particles
    if (particlesRef.current) {
      for (let i = 0; i < 50; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.top = `${Math.random() * 100}%`;
        particle.style.width = `${Math.random() * 4 + 2}px`;
        particle.style.height = particle.style.width;
        particle.style.opacity = `${Math.random() * 0.5 + 0.1}`;
        particlesRef.current.appendChild(particle);
      }

      // Animate particles
      animate('.particle', {
        translateX: () => utils.random(-100, 100),
        translateY: () => utils.random(-100, 100),
        scale: () => utils.random(0.5, 1.5),
        opacity: () => utils.random(0.3, 0.6),
        duration: () => utils.random(3000, 6000),
        delay: () => utils.random(0, 2000),
        alternate: true,
        loop: true,
        ease: 'inOutSine',
      });
    }

    // Background gradient animation
    animate('.gradient-orb', {
      scale: [1, 1.2, 1],
      duration: 8000,
      alternate: true,
      loop: true,
      ease: 'inOutSine',
    });

  }, []);

  // Show toast notification
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !email.includes('@')) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        showToast(data.message, 'success');
        setEmail('');
      } else {
        showToast(data.message, 'error');
      }
    } catch (error) {
      showToast('Unable to connect. Please try again later.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app" ref={containerRef}>
      {/* Background Elements */}
      <div className="background">
        <div className="gradient-orb orb-1"></div>
        <div className="gradient-orb orb-2"></div>
        <div className="gradient-orb orb-3"></div>
        <div className="particles" ref={particlesRef}></div>
        <div className="grid-overlay"></div>
      </div>

      {/* Connect: goes to Web3 app (Wagmi login at /app/) */}
      <header className="header-connect">
        <a href="/app/" className="connect-btn" aria-label="Connect to wallet">
          Connect
        </a>
      </header>

      {/* Main Content */}
      <main className="content">
        <div className="logo-container">
          <div className="logo-icon">
            <svg viewBox="0 0 100 100" className="logo-svg">
              <defs>
                <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="50%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="45" fill="url(#logoGradient)" />
              <text x="50" y="67" fontFamily="Space Grotesk, sans-serif" fontSize="48" fontWeight="bold" fill="white" textAnchor="middle">W</text>
            </svg>
          </div>
        </div>

        <h1 className="title">Wealth Wards</h1>

        <p className="subtitle">Your Financial Guardian</p>

        <div className="coming-soon-container">
          <div className="coming-soon">
            <span className="word">Coming</span>
            <span className="word">Soon</span>
          </div>
        </div>

        <div className="divider"></div>

        <p className="description">
          We're building something extraordinary to help you protect and grow your wealth.
          <br />
          Be the first to know when we launch.
        </p>

        <form className="notify-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <input 
              type="email" 
              placeholder="Enter your email" 
              className="email-input"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
            <button type="submit" className="notify-btn" disabled={isLoading}>
              {isLoading ? (
                <div className="spinner" />
              ) : (
                <>
                  <span>Notify Me</span>
                  <svg className="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </form>

        <div className="social-links">
          <a href="#" className="social-link" aria-label="Twitter">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
          <a href="#" className="social-link" aria-label="LinkedIn">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
          </a>
          <a href="#" className="social-link" aria-label="GitHub">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>&copy; 2026 Wealth Wards. All rights reserved.</p>
      </footer>

      {/* Toast Notification */}
      {toast && (
        <div className={`toast show ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
