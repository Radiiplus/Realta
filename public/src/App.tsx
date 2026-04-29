import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/layout';
import { ConnectWallet } from './pages/connect';
import { CredentialListPage } from './pages/credentials';
import { IssueCredential } from './pages/issuecred';
import { IssuanceSessionPage } from './pages/issuancesession';
import { OrganizationProfile } from './pages/orgprofile';
import { PublicSharePage } from './pages/publicshare';
import { PublicIdentityCardPage } from './pages/publicidcard';
import { PublicOrganizationCardPage } from './pages/publicorgcard';
import { RegisterOrganization } from './pages/regorg';
import { TrustOverview } from './pages/trust';
import { VerificationCenter } from './pages/verify';
import { hasOrgSession, hasWalletSession } from './session';

const Placeholder = ({ title }: { title: string }) => (
  <div className="rounded-neo border border-white/20 bg-[#050505]/90 p-8 shadow-[0_0_0_1px_rgba(0,255,157,0.08)] md:p-10">
    <h2 className="text-2xl font-semibold text-neo-accent">{title}</h2>
  </div>
);

const CredentialDetail = () => <Placeholder title="Credential Detail" />;
const RevokeCredential = () => <Placeholder title="Revoke Credential" />;
const TransferCredential = () => <Placeholder title="Transfer Credential" />;

function WalletRequired({ children }: { children: React.ReactNode }) {
  if (!hasWalletSession()) return <Navigate to="/connect" replace />;
  return <Layout>{children}</Layout>;
}

function OrgRequired({ children }: { children: React.ReactNode }) {
  if (!hasWalletSession()) return <Navigate to="/connect" replace />;
  if (!hasOrgSession()) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/connect" element={<ConnectWallet />} />
        <Route path="/session/:token" element={<IssuanceSessionPage />} />
        <Route path="/v/:slug" element={<PublicSharePage />} />
        <Route path="/id/:slug" element={<PublicIdentityCardPage />} />
        <Route path="/o/:orgId" element={<PublicOrganizationCardPage />} />
        <Route path="/public/id/:slug" element={<PublicIdentityCardPage />} />
        <Route path="/public/org/:orgId" element={<PublicOrganizationCardPage />} />
        <Route
          path="/"
          element={
            <WalletRequired>
              <TrustOverview />
            </WalletRequired>
          }
        />
        <Route
          path="/org/register"
          element={
            <WalletRequired>
              <RegisterOrganization />
            </WalletRequired>
          }
        />
        <Route
          path="/org/profile"
          element={
            <OrgRequired>
              <OrganizationProfile />
            </OrgRequired>
          }
        />
        <Route
          path="/verify"
          element={
            <OrgRequired>
              <VerificationCenter />
            </OrgRequired>
          }
        />
        <Route
          path="/credential/issue"
          element={
            <OrgRequired>
              <IssueCredential />
            </OrgRequired>
          }
        />
        <Route
          path="/credentials"
          element={
            <OrgRequired>
              <CredentialListPage />
            </OrgRequired>
          }
        />
        <Route
          path="/credential/:id"
          element={
            <OrgRequired>
              <CredentialDetail />
            </OrgRequired>
          }
        />
        <Route
          path="/credential/:id/revoke"
          element={
            <OrgRequired>
              <RevokeCredential />
            </OrgRequired>
          }
        />
        <Route
          path="/credential/:id/transfer"
          element={
            <OrgRequired>
              <TransferCredential />
            </OrgRequired>
          }
        />
        <Route path="/public/verify/:id" element={<PublicSharePage />} />
        <Route path="*" element={<Navigate to={hasWalletSession() ? '/' : '/connect'} replace />} />
      </Routes>
    </Router>
  );
}

export default App;
