import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ChevronLeft, ChevronRight, Mail, Sparkles, UserCircle2 } from 'lucide-react';
import { api } from '../api';
import { NeoButton } from '../components/button';
import { NeoCard } from '../components/neocard';
import { NeoInput } from '../components/input';
import { getWalletAddress, hasWalletSession, setOrgSession } from '../session';
import { SOCIAL_PLATFORM_OPTIONS, socialHandlePlaceholder, socialPlatformLabel } from '../social';

type EntityType = 'organization' | 'individual';

type RegisterForm = {
  entityType: EntityType;
  name: string;
  legalName: string;
  industry: string;
  firstName: string;
  lastName: string;
  occupation: string;
  contactEmail: string;
  phone: string;
  country: string;
  city: string;
  addressLine: string;
  website: string;
  socialPlatform: string;
  socialHandle: string;
  description: string;
};

const EMPTY_FORM: RegisterForm = {
  entityType: 'organization',
  name: '',
  legalName: '',
  industry: '',
  firstName: '',
  lastName: '',
  occupation: '',
  contactEmail: '',
  phone: '',
  country: '',
  city: '',
  addressLine: '',
  website: '',
  socialPlatform: 'x',
  socialHandle: '',
  description: '',
};

export const RegisterOrganization = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [step, setStep] = useState(1);

  const walletAddress = getWalletAddress() || '';
  const dimInputClass = '!bg-[#8ca198]/10 !border-transparent focus:!border-neo-accent/10 focus:!bg-[#8ca198]/10 focus:!outline-none';

  const steps = [
    { id: 1, label: 'Identity', icon: Sparkles },
    { id: 2, label: 'Entity', icon: form.entityType === 'organization' ? Building2 : UserCircle2 },
    { id: 3, label: 'Contact', icon: Mail },
    { id: 4, label: 'Review', icon: Check },
  ];

  useEffect(() => {
    if (!hasWalletSession()) {
      navigate('/connect', { replace: true });
    }
  }, [navigate]);

  const setField = (key: keyof RegisterForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validateStep = (targetStep = step) => {
    setError('');

    if (targetStep === 1) {
      if (!form.name.trim()) {
        setError('Display name is required.');
        return false;
      }
      return true;
    }

    if (targetStep === 2) {
      if (form.entityType === 'organization' && !form.legalName.trim()) {
        setError('Legal name is required for organizations.');
        return false;
      }

      if (form.entityType === 'individual' && (!form.firstName.trim() || !form.lastName.trim())) {
        setError('First name and last name are required for individuals.');
        return false;
      }

      if (form.entityType === 'organization' && !form.industry.trim()) {
        setError('Industry is required for organizations.');
        return false;
      }

      if (form.entityType === 'individual' && !form.occupation.trim()) {
        setError('Occupation is required for individuals.');
        return false;
      }

      return true;
    }

    if (targetStep === 3 || targetStep === 4) {
      if (!form.contactEmail.trim() || !form.country.trim() || !form.city.trim() || !form.addressLine.trim() || !form.website.trim()) {
        setError('Email, country, city, address, and website are required.');
        return false;
      }
      return true;
    }

    return true;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((prev) => Math.min(prev + 1, 4));
  };

  const goBack = () => {
    setError('');
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateStep(4)) {
      return;
    }

    setError('');

    setLoading(true);
    try {
      const res = await api.org.register({
        walletAddress,
        entityType: form.entityType,
        name: form.name,
        legalName: form.legalName,
        industry: form.industry,
        firstName: form.firstName,
        lastName: form.lastName,
        occupation: form.occupation,
        contactEmail: form.contactEmail,
        phone: form.phone,
        country: form.country,
        city: form.city,
        addressLine: form.addressLine,
        website: form.website,
        socialPlatform: form.socialPlatform,
        socialHandle: form.socialHandle,
        description: form.description,
      });

      if (res.data?.auth?.orgId && res.data?.auth?.apiKey) {
        setOrgSession(res.data.auth.orgId, res.data.auth.apiKey, form.name);
        navigate('/');
      } else {
        setError('Registration response is incomplete.');
      }
    } catch (err) {
      console.error(err);
      setError('Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell page-stack">
      <NeoCard className="p-6 md:p-7">
        <div className="page-hero">
          <div>
            <div className="page-kicker">Issuer Onboarding</div>
            <h1 className="page-title">Create the issuer profile behind this wallet</h1>
            <p className="page-subtitle">
              Define the identity that will appear on issued credentials, verification screens, and public profile cards.
            </p>
          </div>
          <div className="page-sidecard">
            <div className="page-sidehead">
              <Building2 className="h-4 w-4 text-neo-accent" />
              <span>Connected wallet</span>
            </div>
            <p className="mt-4 break-all text-sm text-[#8ca198]">{walletAddress || 'Not connected'}</p>
            <p className="page-sidecopy">
              Required for verification: display name, contact email, location, address, website, and entity-specific identity fields.
            </p>
          </div>
        </div>
      </NeoCard>

      {error ? (
        <div className="error-card">{error}</div>
      ) : null}

      <NeoCard className="p-6 md:p-7">
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          {steps.map((item) => {
            const Icon = item.icon;
            const active = step === item.id;
            const complete = step > item.id;
            return (
              <div
                key={item.id}
                className={`rounded-[20px] border p-4 transition ${
                  active
                    ? 'border-neo-accent/25 bg-neo-accent/[0.08]'
                    : complete
                      ? 'border-white/12 bg-white/[0.05]'
                      : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="inline-flex items-center gap-2 text-sm text-white">
                  <Icon className={`h-4 w-4 ${active || complete ? 'text-neo-accent' : 'text-[#8ca198]'}`} />
                  <span>{item.label}</span>
                </div>
                <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[#8ca198]">
                  Step {item.id}
                </p>
              </div>
            );
          })}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {step === 1 ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <NeoButton
                  type="button"
                  variant={form.entityType === 'organization' ? 'primary' : 'secondary'}
                  onClick={() => setField('entityType', 'organization')}
                  className="inline-flex items-center justify-center gap-2 px-3"
                  aria-label="Organization issuer"
                  title="Organization issuer"
                >
                  <Building2 className="h-4 w-4" />
                  <span>Organization</span>
                </NeoButton>
                <NeoButton
                  type="button"
                  variant={form.entityType === 'individual' ? 'primary' : 'secondary'}
                  onClick={() => setField('entityType', 'individual')}
                  className="inline-flex items-center justify-center gap-2 px-3"
                  aria-label="Individual issuer"
                  title="Individual issuer"
                >
                  <UserCircle2 className="h-4 w-4" />
                  <span>Individual</span>
                </NeoButton>
              </div>
              <NeoInput
                hideLabel
                className={dimInputClass}
                placeholder={form.entityType === 'organization' ? 'Brand name / public name' : 'Public profile name'}
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                required
              />
            </div>
          ) : null}

          {step === 2 ? (
            form.entityType === 'organization' ? (
              <div className="space-y-4">
                <NeoInput hideLabel className={dimInputClass} placeholder="Legal Name" value={form.legalName} onChange={(e) => setField('legalName', e.target.value)} required />
                <div className="grid gap-3 sm:grid-cols-2">
                  <NeoInput hideLabel className={dimInputClass} placeholder="Industry" value={form.industry} onChange={(e) => setField('industry', e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <NeoInput hideLabel className={dimInputClass} placeholder="First Name" value={form.firstName} onChange={(e) => setField('firstName', e.target.value)} required />
                <NeoInput hideLabel className={dimInputClass} placeholder="Last Name" value={form.lastName} onChange={(e) => setField('lastName', e.target.value)} required />
                <NeoInput hideLabel className={dimInputClass} placeholder="Occupation" value={form.occupation} onChange={(e) => setField('occupation', e.target.value)} />
              </div>
            )
          ) : null}

          {step === 3 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <NeoInput hideLabel className={dimInputClass} placeholder="Contact Email" type="email" value={form.contactEmail} onChange={(e) => setField('contactEmail', e.target.value)} />
              <NeoInput hideLabel className={dimInputClass} placeholder="Phone (Optional)" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
              <NeoInput hideLabel className={dimInputClass} placeholder="Country" value={form.country} onChange={(e) => setField('country', e.target.value)} />
              <NeoInput hideLabel className={dimInputClass} placeholder="City" value={form.city} onChange={(e) => setField('city', e.target.value)} />
              <NeoInput hideLabel className={`${dimInputClass} sm:col-span-2`} placeholder="Address" value={form.addressLine} onChange={(e) => setField('addressLine', e.target.value)} />
              <NeoInput hideLabel className={dimInputClass} placeholder="Website" value={form.website} onChange={(e) => setField('website', e.target.value)} />
              <select
                value={form.socialPlatform}
                onChange={(e) => setField('socialPlatform', e.target.value)}
                className={`w-full rounded-[16px] border border-white/12 px-4 py-3 text-neo-text shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] transition-all focus:border-neo-accent/60 focus:-translate-y-[1px] focus:outline-none ${dimInputClass}`}
              >
                {SOCIAL_PLATFORM_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="bg-[#0b1411]">
                    {option.label}
                  </option>
                ))}
              </select>
              <NeoInput
                hideLabel
                className={dimInputClass}
                placeholder={`${socialPlatformLabel(form.socialPlatform)} (${socialHandlePlaceholder(form.socialPlatform)})`}
                value={form.socialHandle}
                onChange={(e) => setField('socialHandle', e.target.value)}
                containerClassName="sm:col-span-2"
              />
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <div className="metric-grid">
                <div className="metric-card">
                  <span className="metric-label">Entity Type</span>
                  <span className="metric-value capitalize">{form.entityType}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Display Name</span>
                  <span className="metric-value">{form.name || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">{form.entityType === 'organization' ? 'Legal Name' : 'Full Name'}</span>
                  <span className="metric-value">
                    {form.entityType === 'organization'
                      ? (form.legalName || 'N/A')
                      : `${form.firstName} ${form.lastName}`.trim() || 'N/A'}
                  </span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">{form.entityType === 'organization' ? 'Industry' : 'Occupation'}</span>
                  <span className="metric-value">{form.entityType === 'organization' ? (form.industry || 'N/A') : (form.occupation || 'N/A')}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Email</span>
                  <span className="metric-value break-all">{form.contactEmail || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Location</span>
                  <span className="metric-value">{[form.city, form.country].filter(Boolean).join(', ') || 'N/A'}</span>
                </div>
                <div className="metric-card sm:col-span-2">
                  <span className="metric-label">Address</span>
                  <span className="metric-value">{form.addressLine || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Website</span>
                  <span className="metric-value break-all">{form.website || 'N/A'}</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">{socialPlatformLabel(form.socialPlatform)}</span>
                  <span className="metric-value break-all">{form.socialHandle || 'N/A'}</span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-[#8ca198]">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  rows={4}
                  className="w-full rounded-[16px] border border-white/12 bg-[#8ca198]/10 px-4 py-3 text-neo-text shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)] placeholder-[#61756d] transition-all focus:border-neo-accent/60 focus:-translate-y-[1px] focus:outline-none"
                  placeholder="Description (Optional)"
                />
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <NeoButton
              type="button"
              variant="secondary"
              onClick={goBack}
              disabled={step === 1 || loading}
              className="inline-flex items-center justify-center gap-2 px-4"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </NeoButton>

            {step < 4 ? (
              <NeoButton
                type="button"
                onClick={goNext}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 px-4"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </NeoButton>
            ) : (
              <NeoButton
                type="submit"
                loading={loading}
                className="inline-flex items-center justify-center gap-2 px-4"
                aria-label="Create issuer"
                title="Create issuer"
              >
                <Check className="h-4 w-4" />
                <span>Create Issuer</span>
              </NeoButton>
            )}
          </div>
        </form>
      </NeoCard>
    </div>
  );
};
