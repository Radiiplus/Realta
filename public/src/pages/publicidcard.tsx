import { Building2, Link2, Mail, ShieldCheck, Sparkles, UserCircle2, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { NeoCard } from '../components/neocard';

type IdentityPayload = {
  credentialId: string;
  title?: string;
  status?: string;
  recipientDisplayName?: string;
  recipientReference?: string | null;
  claimant?: {
    walletAddress?: string | null;
    fullName?: string | null;
    email?: string | null;
    reference?: string | null;
  } | null;
  orgId?: string;
  orgShareSlug?: string | null;
  issuer?: { name?: string } | null;
};

type PublicOrg = {
  id?: string;
  name?: string;
  entityType?: 'organization' | 'individual';
};

function MasonryItem({
  icon,
  label,
  value,
  verified = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  verified?: boolean;
}) {
  return (
    <div className="break-inside-avoid mb-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 text-emerald-400 flex-shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide flex items-center gap-1">
            {label}
            {verified ? <ShieldCheck className="h-3 w-3 text-emerald-500 flex-shrink-0" /> : null}
          </p>
          <p className="text-sm text-gray-100 break-words leading-snug">{value}</p>
        </div>
      </div>
    </div>
  );
}

export function PublicIdentityCardPage() {
  const { slug } = useParams<{ slug?: string }>();
  const [searchParams] = useSearchParams();
  const isEmbed = ['1', 'true', 'yes'].includes(String(searchParams.get('embed') || '').toLowerCase());
  const shareSlug = String(slug || '').trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<IdentityPayload | null>(null);
  const [org, setOrg] = useState<PublicOrg | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!shareSlug) {
        setError('Missing identity slug.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const shareRes = await api.credential.shareGet(shareSlug);
        const nextPayload = (shareRes.data || null) as IdentityPayload;
        if (cancelled) return;
        setPayload(nextPayload);

        const orgId = String(nextPayload?.orgId || '').trim();
        if (orgId) {
          const orgRes = await api.org.get(orgId);
          if (!cancelled) setOrg((orgRes.data?.organization || null) as PublicOrg | null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error || 'Identity card not found.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [shareSlug]);

  const holderName = payload?.claimant?.fullName || payload?.recipientDisplayName || 'Unknown User';
  const issuedBy = org?.name || payload?.issuer?.name || 'Unknown Organization';
  const statusValue = String(payload?.status || 'unknown');

  const masonryItems = [
    { icon: <UserCircle2 className="h-4 w-4" />, label: 'Holder', value: holderName },
    { icon: <Mail className="h-4 w-4" />, label: 'Email', value: payload?.claimant?.email || 'N/A' },
    { icon: <Wallet className="h-4 w-4" />, label: 'Wallet', value: payload?.claimant?.walletAddress || 'N/A' },
    { icon: <Link2 className="h-4 w-4" />, label: 'Reference', value: payload?.claimant?.reference || payload?.recipientReference || 'N/A' },
    { icon: <ShieldCheck className="h-4 w-4" />, label: 'Status', value: statusValue, verified: statusValue.toLowerCase() === 'issued' },
    { icon: <Building2 className="h-4 w-4" />, label: 'Organization', value: issuedBy },
  ];

  return (
    <div className={isEmbed ? 'relative w-full bg-transparent overflow-hidden p-1' : 'relative h-screen w-screen bg-[#050505] overflow-hidden flex items-center justify-center p-2'}>
      {!isEmbed ? <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-900/10 via-[#050505] to-[#050505] pointer-events-none" /> : null}

      {!isEmbed ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[400px] h-[400px] bg-emerald-500/4 rounded-full blur-3xl" />
          <div className="absolute w-[280px] h-[280px] bg-emerald-500/3 rounded-full blur-2xl" />
        </div>
      ) : null}

      <div className="relative z-10 w-full max-w-3xl mx-auto">
        {loading ? (
          <NeoCard className="border-white/10 bg-[#050505]/60 backdrop-blur-xl p-4">
            <div className="h-2.5 w-20 bg-white/10 rounded mb-2" />
            <div className="h-4 w-36 bg-white/10 rounded mb-3" />
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-white/5 rounded" />)}
            </div>
          </NeoCard>
        ) : null}

        {!loading && error ? (
          <NeoCard className="border-red-500/30 bg-red-950/30 backdrop-blur-xl p-4 text-center">
            <p className="text-xs text-red-300">{error}</p>
          </NeoCard>
        ) : null}

        {!loading && !error && payload ? (
          <NeoCard
            className="
              relative border border-emerald-500/15 bg-gradient-to-br from-[#050505]/95 via-[#08080c]/95 to-[#050505]/95
              backdrop-blur-2xl shadow-2xl shadow-emerald-500/5 rounded-2xl p-4 md:p-5 overflow-hidden
            "
          >
            <div className="absolute top-3 left-3 w-1 h-1 rounded-full bg-emerald-400/40" />
            <div className="absolute top-3 right-3 w-1 h-1 rounded-full bg-emerald-400/40" />
            <div className="absolute bottom-3 left-3 w-1 h-1 rounded-full bg-emerald-400/40" />
            <div className="absolute bottom-3 right-3 w-1 h-1 rounded-full bg-emerald-400/40" />

            <div className="relative z-10 pb-3 border-b border-white/10 mb-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-400/80">
                <Sparkles className="h-2.5 w-2.5" />
                <span>Identity</span>
              </div>

              <h1 className="mt-1 text-lg md:text-xl font-semibold text-white leading-tight">{holderName}</h1>
              <p className="mt-1 text-xs text-gray-400">{payload.title || 'Credential Holder'}</p>
            </div>

            <div className="relative z-10 columns-1 sm:columns-2 gap-x-4 gap-y-1">
              {masonryItems.map((item, idx) => (
                <MasonryItem key={idx} {...item} />
              ))}
            </div>

            {payload.orgShareSlug ? (
              <div className="relative z-10 mt-3 pt-3 border-t border-white/10">
                <Link className="text-sm text-emerald-300 hover:text-emerald-200 underline" to={`/public/org/${encodeURIComponent(payload.orgShareSlug)}`}>
                  View organization card
                </Link>
              </div>
            ) : null}
          </NeoCard>
        ) : null}
      </div>
    </div>
  );
}
