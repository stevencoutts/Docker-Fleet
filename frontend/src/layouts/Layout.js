import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Footer from '../components/Footer';

const Layout = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const backupRef = useRef(null);
  const settingsRef = useRef(null);
  const backupAnchorRef = useRef(null);
  const settingsAnchorRef = useRef(null);
  const backupMenuRef = useRef(null);
  const settingsMenuRef = useRef(null);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setBackupOpen(false);
    setSettingsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const closeIfOutside = (e) => {
      const insideBackup =
        backupRef.current?.contains(e.target) || backupMenuRef.current?.contains(e.target);
      const insideSettings =
        settingsRef.current?.contains(e.target) || settingsMenuRef.current?.contains(e.target);
      if (backupOpen && !insideBackup) setBackupOpen(false);
      if (settingsOpen && !insideSettings) setSettingsOpen(false);
    };
    document.addEventListener('click', closeIfOutside, true);
    return () => document.removeEventListener('click', closeIfOutside, true);
  }, [backupOpen, settingsOpen]);

  const backupItems = [
    { name: 'Scheduled backups', path: '/scheduled-backups' },
    { name: 'Backup & Restore', path: '/backup-restore' },
  ];

  const settingsItems = [
    { name: 'Profile', path: '/profile' },
    { name: 'Monitoring', path: '/monitoring' },
    ...(user?.role === 'admin'
      ? [
          { name: 'Users', path: '/admin/users' },
          { name: 'App configuration', path: '/admin/app-config' },
        ]
      : []),
  ];

  const allNavItems = [
    { name: 'Dashboard', path: '/' },
    ...backupItems,
    ...settingsItems,
  ];

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const navLinkClass = (path) =>
    `block px-3 py-2 rounded-t-md text-sm font-medium transition-colors whitespace-nowrap border-b-2 -mb-px ${
      isActive(path)
        ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300 bg-primary-50/50 dark:bg-primary-900/10'
        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
    }`;

  const dropdownItemClass = (path) =>
    `block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 ${
      isActive(path) ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-medium' : ''
    }`;

  const Dropdown = ({ label, items, open, setOpen, dropdownRef, anchorRef, menuRef }) => {
    const [position, setPosition] = useState({ top: 0, left: 0 });
    useEffect(() => {
      if (open && anchorRef?.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        setPosition({ top: rect.bottom + 4, left: rect.left });
      }
    }, [open, anchorRef]);

    return (
      <>
        <div className="relative inline-block" ref={dropdownRef}>
          <button
            type="button"
            ref={anchorRef}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(!open);
            }}
            className={`inline-flex items-center gap-1 px-3 py-2 rounded-t-md text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              items.some((i) => isActive(i.path))
                ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300 bg-primary-50/50 dark:bg-primary-900/10'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
            aria-expanded={open}
            aria-haspopup="true"
          >
            {label}
            <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
        {open &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={menuRef}
              className="fixed z-[9999] min-w-[10rem] rounded-md bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-600 py-1"
              style={{ top: position.top, left: position.left }}
              role="menu"
            >
              {items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={dropdownItemClass(item.path)}
                  onClick={() => setOpen(false)}
                  role="menuitem"
                >
                  {item.name}
                </Link>
              ))}
            </div>,
            document.body
          )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col transition-colors duration-200">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-nowrap items-center justify-between gap-4 py-3 min-h-[4rem] sm:py-4 sm:h-16 overflow-visible">
            <div className="flex items-center gap-4 lg:gap-8 min-w-0 flex-1 overflow-visible">
              <div className="flex-shrink-0">
                <Link to="/" className="text-xl font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors whitespace-nowrap">
                  DockerFleet
                </Link>
              </div>
              <div className="hidden sm:flex items-center flex-1 min-w-0 overflow-x-auto overflow-y-visible scrollbar-hide border-l border-gray-200 dark:border-gray-600 pl-4 lg:pl-6 pr-4 gap-2 sm:gap-4">
                <Link to="/" className={navLinkClass('/')}>Dashboard</Link>
                <Dropdown
                  label="Backup"
                  items={backupItems}
                  open={backupOpen}
                  setOpen={(v) => {
                    if (v) setSettingsOpen(false);
                    setBackupOpen(v);
                  }}
                  dropdownRef={backupRef}
                  anchorRef={backupAnchorRef}
                  menuRef={backupMenuRef}
                />
                <Dropdown
                  label="Settings"
                  items={settingsItems}
                  open={settingsOpen}
                  setOpen={(v) => {
                    if (v) setBackupOpen(false);
                    setSettingsOpen(v);
                  }}
                  dropdownRef={settingsRef}
                  anchorRef={settingsAnchorRef}
                  menuRef={settingsMenuRef}
                />
              </div>
            </div>
            <div className="flex flex-nowrap items-center gap-2 sm:gap-4 flex-shrink-0">
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
              <span
                className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 shrink-0"
                title={user?.email}
                aria-label={user?.email ? `User: ${user.email}` : 'User'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
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
