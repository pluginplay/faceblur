import { getBetaExpiryLabel } from "../lib/betaGate";
import { openLinkInBrowser } from "../../lib/utils/bolt";

export function BetaLockedScreen() {
  const handleOpenMoreInfo = () => {
    openLinkInBrowser("https://pluginplay.app");
  };

  return (
    <div className="app s-shell">
      <div className="flex-1 min-h-0 px-3 py-2.5 flex items-center justify-center">
        <section
          role="status"
          aria-live="polite"
          className="flex w-full max-w-[650px] max-h-[86vh] flex-col overflow-hidden rounded-2xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-sm"
          style={{ backgroundColor: "var(--panel-bg, #202226)" }}
        >
          <div className="border-b border-white/10 bg-black/10 px-6 py-5">
            <h1 className="s-text-title">
              Face Blur Beta Ended
            </h1>
            <p className="mt-2 max-w-[560px] s-text-body text-[#c5ccd6]">
              This beta build is no longer available.
            </p>
          </div>

          <div className="px-6 py-5">
            <div className="space-y-2.5 s-text-body">
              <div className="rounded-lg border border-white/10 bg-black/15 px-3.5 py-3">
                Beta expiration: {getBetaExpiryLabel()}
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-3.5 py-3 text-[#d7dce4]">
                <button
                  type="button"
                  onClick={() =>
                    openLinkInBrowser(
                      "mailto:danny@pluginplay.app?subject=Help%20with%20FaceBlur"
                    )
                  }
                  className="underline hover:text-white transition-colors"
                >
                  Contact danny@pluginplay.app for further help
                </button>
              </div>
            </div>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-white/10 bg-black/10 px-6 py-4">
            <button
              type="button"
              onClick={handleOpenMoreInfo}
              className="s-button-primary h-9 px-3.5 inline-flex items-center"
            >
              More Info
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}
