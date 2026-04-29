import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgePlus,
  Building2,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  ShieldCheck,
  Unplug,
  UserCircle2,
  Wallet,
} from 'lucide-react';
import { api } from '../api';
import {
  clearOrgSession,
  clearWalletSession,
  getOrgId,
  getOrgKey,
  getOrgName,
  getWalletAddress,
  getWalletLabel,
  hasOrgSession,
  setOrgSession,
} from '../session';

const BASE_NAV = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/org/register', label: 'Create Org', icon: Building2 },
];

const ORG_NAV = [
  { path: '/org/profile', label: 'Profile', icon: UserCircle2 },
  { path: '/verify', label: 'Verification', icon: ShieldCheck },
  { path: '/credential/issue', label: 'Issue', icon: BadgePlus },
  { path: '/credentials', label: 'Credentials', icon: ListChecks },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const walletAddress = getWalletAddress() || 'Not connected';
  const walletLabel = getWalletLabel() || 'Wallet';
  const orgId = getOrgId() || '';
  const [orgName, setOrgName] = useState(getOrgName() || '');
  const orgReady = hasOrgSession();

  const navItems = useMemo(() => {
    if (!orgReady) return BASE_NAV;
    return [...BASE_NAV, ...ORG_NAV];
  }, [orgReady]);

  const handleDisconnectWallet = () => {
    clearWalletSession();
    navigate('/connect');
  };

  const handleDisconnectOrg = () => {
    clearOrgSession();
    navigate('/');
  };

  useEffect(() => {
    setOrgName(getOrgName() || '');
  }, [orgId]);

  useEffect(() => {
    const hydrateOrgName = async () => {
      if (!orgId || orgName) return;
      try {
        const res = await api.org.get(orgId);
        const fetchedName = String(res.data?.organization?.name || '').trim();
        if (fetchedName) {
          const existingOrgKey = getOrgKey();
          if (existingOrgKey) {
            setOrgSession(orgId, existingOrgKey, fetchedName);
          }
          setOrgName(fetchedName);
        }
      } catch (err) {
        console.error(err);
      }
    };
    void hydrateOrgName();
  }, [orgId, orgName]);

  return (
    <div className="h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(0,255,157,0.16),transparent_28%),radial-gradient(circle_at_right_20%,rgba(0,136,255,0.18),transparent_32%),linear-gradient(145deg,#04110d_0%,#06151f_44%,#020406_100%)]">
      <header className="sticky top-0 z-30 rounded-b-lg bg-[#04080a]/50 backdrop-blur-xl">
        <div className="flex w-full items-center justify-between px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-left text-lg font-semibold tracking-wide text-neo-accent"
          >
            NDCP <span className="text-white">Portal</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-neo p-2 text-sm text-gray-200 md:hidden"
            title="Open menu"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>

          <div className="hidden items-center gap-3 md:flex">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1 text-xs text-gray-300">
              <Wallet className="h-3.5 w-3.5" />
              {walletLabel}
            </span>
            <span className="max-w-[230px] truncate rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] text-gray-400">
              {walletAddress}
            </span>
            {orgId ? (
              <span className="max-w-[220px] truncate rounded-full border border-neo-accent/20 bg-neo-accent/10 px-2.5 py-1 text-[11px] text-neo-accent">
                {orgName || 'Active Organization'}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-57px)] w-full min-w-0 flex-col gap-3 overflow-hidden md:flex-row md:gap-4 md:px-4 md:py-3">
        <aside
          className={`${mobileOpen ? 'block' : 'hidden'} bg-[#04080a]/88 p-4 md:sticky md:top-[69px] md:block md:h-[calc(100vh-81px)] md:w-fit md:flex-shrink-0 md:overflow-y-auto md:rounded-[15px] md:bg-[#04080a]/75 md:p-3 md:shadow-[0_30px_80px_rgba(0,0,0,0.28)]`}
        >
          <nav className="flex gap-2 md:flex-col">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileOpen(false)}
                  title={item.label}
                  aria-label={item.label}
                  className={`inline-flex items-center justify-center rounded-neo p-2.5 transition ${
                    location.pathname === item.path
                      ? 'border border-neo-accent/30 bg-neo-accent/10 text-neo-accent shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]'
                      : 'border border-white/15 bg-white/[0.04] text-gray-300 hover:border-neo-accent/25 hover:bg-white/[0.07] hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </Link>
              );
            })}
          </nav>

          <div className="mt-4 flex gap-2 border-t border-white/10 pt-4 md:flex-col">
            {orgReady ? (
              <button
                type="button"
                onClick={handleDisconnectOrg}
                title="Clear active organization"
                aria-label="Clear active organization"
                className="inline-flex items-center justify-center rounded-neo border border-white/15 bg-white/[0.04] p-2.5 text-gray-300 hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
              >
                <Unplug className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleDisconnectWallet}
              title="Disconnect wallet"
              aria-label="Disconnect wallet"
              className="inline-flex items-center justify-center rounded-neo border border-white/15 bg-white/[0.04] p-2.5 text-gray-300 hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1">
          <div className="flex h-full min-h-0 w-full min-w-0 flex-col rounded-[28px] border border-white/10 bg-[#04080a]/52 p-3 shadow-[0_30px_80px_rgba(0,0,0,0.22)]">
            <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
};
