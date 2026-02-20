import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Footer from '../components/Footer';

const Layout = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const adminNavigation = user?.role === 'admin' ? [
    { name: 'Users', path: '/admin/users' },
  ] : [];

  const personalNavigation = [
    { name: 'Scheduled backups', path: '/scheduled-backups' },
    { name: 'Profile', path: '/profile' },
    { name: 'Monitoring', path: '/monitoring' },
  ];

  const allNavItems = [
    { name: 'Dashboard', path: '/' },
    ...adminNavigation,
    ...personalNavigation,
  ];

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const navLinkClass = (path) =>
    `block px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
      isActive(path)
        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
    }`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col transition-colors duration-200">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-stretch justify-between gap-x-6 gap-y-3 py-3 min-h-[4rem] sm:py-4 sm:min-h-0 sm:h-16 sm:flex-nowrap">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 min-w-0">
              <div className="flex-shrink-0">
                <Link to="/" className="text-xl font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors whitespace-nowrap">
                  DockerFleet Manager
                </Link>
              </div>
              <div className="hidden sm:flex items-center gap-1 border-l border-gray-200 dark:border-gray-600 pl-6">
                <Link to="/" className={navLinkClass('/')}>Dashboard</Link>
                {adminNavigation.length > 0 && (
                  <>
                    {adminNavigation.map((item) => (
                      <Link key={item.name} to={item.path} className={navLinkClass(item.path)}>{item.name}</Link>
                    ))}
                    <span className="text-gray-300 dark:text-gray-600 mx-1" aria-hidden>|</span>
                  </>
                )}
                {personalNavigation.map((item) => (
                  <Link key={item.name} to={item.path} className={navLinkClass(item.path)}>{item.name}</Link>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 flex-shrink-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((o) => !o)}
                className="sm:hidden p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-[8rem] sm:max-w-[12rem]" title={user?.email}>
                {user?.email}
              </span>
              <button
                onClick={logout}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 rounded-lg transition-colors whitespace-nowrap"
              >
                Logout
              </button>
            </div>
          </div>
          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="sm:hidden border-t border-gray-200 dark:border-gray-700 py-2">
              <div className="flex flex-col gap-0.5">
                {allNavItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={navLinkClass(item.path)}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex-1 w-full min-w-0 overflow-x-hidden">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
};

export default Layout;
