import { Building2, Globe2, Mail, MapPin, Phone, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { NeoCard } from '../components/neocard';
import { socialPlatformLabel } from '../social';

type PublicOrg = {
  id?: string;
  name?: string;
  entityType?: 'organization' | 'individual';
  contactEmail?: string | null;
  profileLockedAt?: string | null;
  profile?: Record<string, string>;
  verification?: {
    twitter?: { status?: string };
    website?: { status?: string };
  };
};

// Clean icon + label + value masonry item
function MasonryItem({ icon, label, value, isLink = false, verified = false }: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  isLink?: boolean;
  verified?: boolean;
}) {
  return (
    <div className="break-inside-avoid mb-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 text-emerald-400 flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide flex items-center gap-1">
            {label}
            {verified && <ShieldCheck className="h-3 w-3 text-emerald-500 flex-shrink-0" />}
          </p>
          {isLink && value && value !== 'N/A' ? (
            <a 
              href={value.startsWith('http') ? value : `https://${value}`}
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm text-gray-100 hover:text-emerald-300 transition-colors break-words block leading-snug"
            >
              {value}
            </a>
          ) : (
            <p className="text-sm text-gray-100 break-words leading-snug">{value}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function PublicOrganizationCardPage() {
  const { orgId: shareSlug } = useParams<{ orgId?: string }>();
  const [searchParams] = useSearchParams();
  const isEmbed = ['1', 'true', 'yes'].includes(String(searchParams.get('embed') || '').toLowerCase());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [org, setOrg] = useState<PublicOrg | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cleanShareSlug = String(shareSlug || '').trim();
      if (!cleanShareSlug) { setError('Missing organization id.'); setLoading(false); return; }
      setLoading(true); setError('');
      try {
        try {
          const shareRes = await api.org.shareGet(cleanShareSlug);
          if (!cancelled) setOrg(shareRes.data?.organization as PublicOrg | null);
        } catch {
          const res = await api.org.get(cleanShareSlug);
          if (!cancelled) setOrg(res.data?.organization as PublicOrg | null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error || 'Organization not found.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [shareSlug]);

  // Masonry items array (compact, icon-driven)
  const masonryItems = [
    { icon: <Mail className="h-4 w-4" />, label: 'Email', value: org?.contactEmail || 'N/A' },
    { icon: <Phone className="h-4 w-4" />, label: 'Phone', value: org?.profile?.phone || 'N/A' },
    { 
      icon: <Globe2 className="h-4 w-4" />, 
      label: 'Website', 
      value: org?.profile?.website || 'N/A', 
      isLink: true,
      verified: org?.verification?.website?.status === 'verified'
    },
    { icon: <MapPin className="h-4 w-4" />, label: 'Location', value: [org?.profile?.city, org?.profile?.country].filter(Boolean).join(', ') || 'N/A' },
    { icon: <Building2 className="h-4 w-4" />, label: 'Industry', value: org?.profile?.industry || 'N/A' },
    {
      icon: <ShieldCheck className="h-4 w-4" />,
      label: socialPlatformLabel(String(org?.profile?.socialPlatform || (org?.profile?.twitter ? 'x' : 'custom'))),
      value: org?.profile?.socialHandle || org?.profile?.twitter || 'N/A',
      isLink: true,
      verified: org?.verification?.twitter?.status === 'verified',
    },
  ];

  const socialVerified = org?.verification?.twitter?.status === 'verified';
  const companyVerified = Boolean(String(org?.profileLockedAt || '').trim());
  const verificationLabel = companyVerified ? 'Verified Organization' : 'Unverified Organization';

  return (
    <div className={isEmbed ? 'relative w-full bg-transparent overflow-hidden p-1' : 'relative h-screen w-screen bg-[#050505] overflow-hidden flex items-center justify-center p-2'}>
      {/* Subtle radial gradient */}
      {!isEmbed ? <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-900/10 via-[#050505] to-[#050505] pointer-events-none" /> : null}
      
      {/* Soft ambient glow */}
      {!isEmbed ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[400px] h-[400px] bg-emerald-500/4 rounded-full blur-3xl" />
          <div className="absolute w-[280px] h-[280px] bg-emerald-500/3 rounded-full blur-2xl" />
        </div>
      ) : null}

      {/* Main content */}
      <div className="relative z-10 w-full max-w-3xl mx-auto">
        {loading && (
          <NeoCard className="border-white/10 bg-[#050505]/60 backdrop-blur-xl p-4">
            <div className="h-2.5 w-20 bg-white/10 rounded mb-2" />
            <div className="h-4 w-36 bg-white/10 rounded mb-3" />
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-white/5 rounded" />)}
            </div>
          </NeoCard>
        )}

        {!loading && error && (
          <NeoCard className="border-red-500/30 bg-red-950/30 backdrop-blur-xl p-4 text-center">
            <p className="text-xs text-red-300 flex items-center justify-center gap-1.5">⚡ {error}</p>
          </NeoCard>
        )}

        {!loading && !error && org && (
          <NeoCard 
            className="
              relative border border-emerald-500/15 bg-gradient-to-br from-[#050505]/95 via-[#08080c]/95 to-[#050505]/95 
              backdrop-blur-2xl shadow-2xl shadow-emerald-500/5 rounded-2xl p-4 md:p-5 overflow-hidden
            "
          >
            {/* Minimal corner accents */}
            <div className="absolute top-3 left-3 w-1 h-1 rounded-full bg-emerald-400/40" />
            <div className="absolute top-3 right-3 w-1 h-1 rounded-full bg-emerald-400/40" />
            <div className="absolute bottom-3 left-3 w-1 h-1 rounded-full bg-emerald-400/40" />
            <div className="absolute bottom-3 right-3 w-1 h-1 rounded-full bg-emerald-400/40" />

            {/* Header */}
            <div className="relative z-10 pb-3 border-b border-white/10 mb-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-400/80">
                <Sparkles className="h-2.5 w-2.5" />
                <span>Organization</span>
              </div>
              
              <h1 className="mt-1 text-lg md:text-xl font-semibold text-white leading-tight">
                {org.name || 'Unknown Organization'}
              </h1>
              
              <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-emerald-500/20 text-[10px] text-gray-300">
                <Building2 className="h-3 w-3 text-emerald-400" />
                <span className="capitalize">{org.entityType || 'organization'}</span>
                {socialVerified ? (
                  <span title="Social Verified" className="inline-flex">
                    <ShieldCheck className="h-3 w-3 text-emerald-500" />
                  </span>
                ) : null}
              </div>
              <div
                className={`mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] ${
                  companyVerified
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                    : 'border-yellow-500/25 bg-yellow-500/10 text-yellow-200'
                }`}
              >
                <ShieldCheck className="h-3 w-3" />
                <span>{verificationLabel}</span>
              </div>
            </div>

            {/* True Masonry Layout */}
            <div className="relative z-10 columns-1 sm:columns-2 gap-x-4 gap-y-1">
              {masonryItems.map((item, idx) => (
                <MasonryItem key={idx} {...item} />
              ))}
            </div>
          </NeoCard>
        )}
      </div>
    </div>
  );
}
