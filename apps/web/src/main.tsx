import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const APP_NAME = "TODO: App name";
const APK_URL = "TODO: APK link";

function DownloadLink({ className = "" }: { className?: string }) {
  return (
    <a className={`download-link ${className}`} href={APK_URL} aria-label={`Download ${APP_NAME} for Android`}>
      Download for Android <span aria-hidden="true">↗</span>
    </a>
  );
}

function Phone({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`phone ${compact ? "phone-compact" : ""}`} aria-label="Preview of the expense tracker quick-add screen">
      <div className="phone-status"><span>9:41</span><span>◖◖ ▰</span></div>
      <div className="phone-top"><span className="phone-back">←</span><span>New expense</span><span className="phone-more">···</span></div>
      <div className="phone-content">
        <span className="eyebrow">AMOUNT</span>
        <div className="amount">₹<span>30</span><small>.00</small></div>
        <div className="phone-rule" />
        <span className="eyebrow">CATEGORY</span>
        <div className="category-selected"><span className="category-mark">F</span><span>Food</span><span className="check">✓</span></div>
        <span className="eyebrow entry-label">ADD WITH A NOTE</span>
        <div className="entry-box">chai 30, auto 120 yesterday<span className="cursor" /></div>
        <div className="phone-hint">We’ll prepare drafts for you to review.</div>
        <button className="phone-save" type="button">Save expense <span>→</span></button>
      </div>
      <div className="phone-home" />
    </div>
  );
}

function App() {
  return (
    <>
      <header className="site-header wrap">
        <a className="wordmark" href="#top" aria-label={`${APP_NAME} home`}><span className="wordmark-mark">e.</span><span>{APP_NAME}</span></a>
        <nav aria-label="Main navigation"><a href="#offline">Offline</a><a href="#ai">AI entry</a><a href="#privacy">Privacy</a></nav>
        <DownloadLink className="nav-download" />
      </header>
      <main id="top">
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="kicker">A calmer way to keep track</span>
            <h1 id="hero-title">Know where<br />your money <em>goes.</em></h1>
            <p className="hero-subline">A simple expense tracker for Android. Add an expense in seconds, even without internet.</p>
            <div className="hero-actions"><DownloadLink /><a className="text-link" href="#how">See how it works <span aria-hidden="true">↓</span></a></div>
            <p className="availability">For Android <span>·</span> Your phone, first</p>
          </div>
          <div className="hero-art"><div className="art-index">01 <span>QUICK ADD</span></div><Phone /></div>
        </section>

        <section className="five wrap section" id="how" aria-labelledby="five-title">
          <div className="section-index">01 / THE EVERYDAY</div>
          <div className="five-layout">
            <div><h2 id="five-title">Five seconds.<br /><em>Back to your day.</em></h2><p>Tap Add, enter the amount, choose a category. Your expense is saved on your phone right away.</p></div>
            <div className="quick-visual"><div className="quick-top"><span>JUST ADDED</span><span>Today · 9:41</span></div><div className="quick-item"><div className="quick-symbol">F</div><div className="quick-desc"><strong>Chai</strong><span>Food · Just now</span></div><strong className="quick-amount">−₹30</strong></div><div className="quick-bottom"><span>Saved on this device</span><span className="saved-mark">✓</span></div></div>
          </div>
        </section>

        <section className="offline section" id="offline" aria-labelledby="offline-title"><div className="wrap offline-layout">
          <div className="section-index">02 / YOUR DATA</div><div className="offline-copy"><h2 id="offline-title">Works offline.<br /><em>Because life does.</em></h2><p>Your phone is the source of truth. Add, edit, and review expenses without a connection. When you’re online, changes sync in the background.</p></div>
          <div className="sync-visual" aria-label="Expenses are saved on your phone and sync when you are online"><div className="sync-device"><span>ON YOUR PHONE</span><strong>Expenses</strong><small>Saved locally</small></div><div className="sync-line"><span>↔</span><small>when online</small></div><div className="sync-cloud"><span className="sync-dot" /><strong>Synced</strong></div></div>
        </div></section>

        <section className="ai section wrap" id="ai" aria-labelledby="ai-title"><div className="section-index">03 / A LITTLE HELP</div><div className="ai-layout">
          <div className="ai-copy"><h2 id="ai-title">Say it the<br /><em>way you think.</em></h2><p>Type a quick note like “chai 30, auto 120 yesterday.” The app turns it into draft expenses and suggests categories.</p><div className="ai-note"><span className="note-mark">↳</span><span>You review and confirm every draft. AI never does the math.</span></div></div>
          <div className="draft-preview"><div className="draft-heading"><span>YOUR NOTE</span><span>REVIEW DRAFTS</span></div><div className="draft-input">“chai 30, auto 120 yesterday”</div><div className="draft-divider" /><div className="draft-row"><span className="draft-number">01</span><span><strong>Chai</strong><small>Food · Yesterday</small></span><b>₹30</b></div><div className="draft-row"><span className="draft-number">02</span><span><strong>Auto</strong><small>Transport · Yesterday</small></span><b>₹120</b></div><div className="draft-confirm">Review each one, then confirm <span>→</span></div></div>
        </div></section>

        <section className="privacy section" id="privacy" aria-labelledby="privacy-title"><div className="wrap privacy-layout"><div className="section-index">04 / YOURS TO KEEP</div><h2 id="privacy-title">Personal finances<br /><em>stay personal.</em></h2><div className="privacy-copy"><p>Your expenses live on your phone first. AI features need an internet connection; only the information needed to prepare suggestions is sent. Sensitive identifiers are never sent.</p><a className="text-link" href={`mailto:TODO: privacy contact email`}>Privacy questions <span aria-hidden="true">↗</span></a></div></div></section>

        <section className="final-cta wrap" aria-labelledby="cta-title"><div className="cta-rule" /><div className="cta-index">A SMALL HABIT, MADE EASIER</div><div className="cta-layout"><h2 id="cta-title">Start with<br /><em>the next one.</em></h2><div><p>Keep a clearer record of where your money goes.</p><DownloadLink /><span className="cta-platform">Android app <span>·</span> TODO: App name</span></div></div></section>
      </main>
      <footer className="site-footer wrap"><a className="wordmark" href="#top"><span className="wordmark-mark">e.</span><span>{APP_NAME}</span></a><span className="footer-note">Made for the everyday.</span><a href="mailto:TODO: privacy contact email">Privacy contact</a><span className="copyright">© 2026</span></footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
