import React, { useCallback, useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import {
  authClient,
  AUTH_URL,
  signInWithSocial,
  updateLastSignInTime,
  type SocialProvider,
} from "../lib/auth";
import { AlertCircle, ArrowRight, Check, Loader2, Lock, Mail, User } from "lucide-react";
import logoIcon from "../assets/icon.png";
import ForgotPasswordView from "./ForgotPasswordView";

interface AuthenticationStepProps {
  onContinueWithoutAccount?: () => void;
  onAuthComplete: () => void;
  onNeedsVerification: (email: string) => void;
}

type AuthMode = "sign-in" | "sign-up";

const GoogleIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

/** Labeled text field with a leading icon — the auth design-system input. */
function AuthField({
  label,
  icon,
  ...inputProps
}: { label: string; icon: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-white/70">{label}</span>
      <div className="group relative flex items-center">
        <span className="pointer-events-none absolute left-3 text-white/35">{icon}</span>
        <input
          {...inputProps}
          className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-10 pr-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-white/25 focus:bg-white/[0.06] focus:ring-2 focus:ring-white/10 disabled:opacity-50"
        />
      </div>
    </label>
  );
}

export default function AuthenticationStep({
  onContinueWithoutAccount,
  onAuthComplete,
  onNeedsVerification,
}: AuthenticationStepProps) {
  const { t } = useTranslation();
  const { isSignedIn, isLoaded, user } = useAuth();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSocialLoading, setIsSocialLoading] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);

  const needsVerificationRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || needsVerificationRef.current || !user?.id || !user?.email)
      return;
    onAuthComplete();
  }, [isLoaded, isSignedIn, user, onAuthComplete]);

  // Reset the social spinner if the window regains focus without completing.
  useEffect(() => {
    if (isSocialLoading === null) return;
    let timeout: ReturnType<typeof setTimeout>;
    const handleFocus = () => {
      timeout = setTimeout(() => setIsSocialLoading(null), 1000);
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      clearTimeout(timeout);
    };
  }, [isSocialLoading]);

  const handleSocialSignIn = useCallback(
    async (provider: SocialProvider) => {
      setIsSocialLoading(provider);
      setError(null);
      const result = await signInWithSocial(provider);
      if (result.error) {
        setError(
          result.error.message ||
            t("auth.errors.failedProviderSignIn", {
              provider: provider.charAt(0).toUpperCase() + provider.slice(1),
            })
        );
        setIsSocialLoading(null);
      }
    },
    [t]
  );

  const errorMessageIncludes = (message: string | undefined, keywords: string[]): boolean => {
    if (!message) return false;
    const lower = message.toLowerCase();
    return keywords.some((k) => lower.includes(k));
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!authClient) {
        setError(t("auth.errors.authNotConfigured"));
        return;
      }
      const localPart = email.trim().split("@")[0];
      if (localPart?.includes("+")) {
        setError(t("auth.errors.plusAliasUnsupported"));
        return;
      }

      setIsSubmitting(true);
      setError(null);
      try {
        if (mode === "sign-up") {
          needsVerificationRef.current = true;
          const result = await authClient.signUp.email({
            email: email.trim(),
            password,
            name: fullName.trim() || email.trim().split("@")[0],
          });
          if (result.error) {
            needsVerificationRef.current = false;
            if (errorMessageIncludes(result.error.message, ["already exists", "already registered"])) {
              setMode("sign-in");
              setError(t("auth.errors.accountExistsSignIn"));
              setPassword("");
            } else {
              setError(result.error.message || t("auth.errors.createAccountFailed"));
            }
          } else {
            updateLastSignInTime();
            onNeedsVerification(email.trim());
          }
        } else {
          const result = await authClient.signIn.email({ email: email.trim(), password });
          if (result.error) {
            if (errorMessageIncludes(result.error.message, ["not found", "no user"])) {
              setMode("sign-up");
              setError(t("auth.errors.accountNotFoundCreate"));
              setPassword("");
            } else {
              setError(result.error.message || t("auth.errors.invalidCredentials"));
            }
          } else {
            updateLastSignInTime();
            onAuthComplete();
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t("auth.errors.generic"));
      } finally {
        setIsSubmitting(false);
      }
    },
    [mode, email, fullName, password, onAuthComplete, onNeedsVerification, t]
  );

  const toggleMode = useCallback(() => {
    setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"));
    setError(null);
    setPassword("");
    setFullName("");
  }, []);

  // ─── Auth not configured ──────────────────────────────────────────────────
  if (!AUTH_URL || !authClient) {
    return (
      <AuthShell>
        <div className="text-center">
          <Brand />
          <p className="mt-6 text-sm text-white/60">{t("auth.cloudNotConfigured")}</p>
          {onContinueWithoutAccount && (
            <button
              onClick={onContinueWithoutAccount}
              className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-6 text-sm font-semibold text-black transition hover:bg-white/90"
            >
              {t("auth.getStarted")}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </AuthShell>
    );
  }

  // ─── Already signed in ────────────────────────────────────────────────────
  if (isLoaded && isSignedIn) {
    return (
      <AuthShell>
        <div className="text-center">
          <Brand />
          <div className="mx-auto mt-6 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="h-5 w-5 text-emerald-400" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-white">
            {user?.name
              ? t("auth.signedIn.welcomeBackName", { name: user.name })
              : t("auth.signedIn.welcomeBack")}
          </h1>
          <p className="mt-1 text-sm text-white/50">{t("auth.signedIn.ready")}</p>
          <button
            onClick={onAuthComplete}
            className="mt-6 inline-flex h-11 w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-white text-sm font-semibold text-black transition hover:bg-white/90"
          >
            {t("auth.common.continue")}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </AuthShell>
    );
  }

  if (forgotPasswordOpen) {
    return (
      <AuthShell>
        <div className="w-full max-w-sm text-white">
          <ForgotPasswordView email={email} onBack={() => setForgotPasswordOpen(false)} />
        </div>
      </AuthShell>
    );
  }

  // ─── Main login (two-panel) ───────────────────────────────────────────────
  return (
    <div className="flex h-full w-full overflow-hidden bg-[#08080b] text-white">
      {/* Left — form */}
      <div className="flex w-full flex-col justify-center overflow-y-auto px-8 py-10 sm:px-12 lg:w-[46%] lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-9 flex items-center gap-2.5">
            <img src={logoIcon} alt="Pyper" className="h-8 w-8 rounded-[9px] shadow-sm" />
            <span className="text-lg font-semibold tracking-tight">Pyper</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {mode === "sign-in"
              ? t("auth.passwordForm.welcomeBack")
              : t("auth.passwordForm.createAccount")}
          </h1>
          <p className="mt-1.5 text-sm text-white/50">{t("auth.welcomeSubtitle")}</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {mode === "sign-up" && (
              <AuthField
                label={t("auth.passwordForm.fullNamePlaceholder")}
                icon={<User className="h-4 w-4" />}
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t("auth.passwordForm.fullNamePlaceholder")}
                autoFocus
              />
            )}
            <AuthField
              label="Email"
              icon={<Mail className="h-4 w-4" />}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailStep.emailPlaceholder")}
              required
              autoFocus={mode === "sign-in"}
            />
            <AuthField
              label={t("auth.passwordForm.enterPasswordPlaceholder")}
              icon={<Lock className="h-4 w-4" />}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={mode === "sign-up" ? 8 : undefined}
            />

            {mode === "sign-in" && (
              <div className="flex items-center justify-between pt-0.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-white/60 select-none">
                  <input
                    type="checkbox"
                    checked={keepSignedIn}
                    onChange={(e) => setKeepSignedIn(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-white/20 bg-white/10 accent-white"
                  />
                  Keep me signed in
                </label>
                <button
                  type="button"
                  onClick={() => setForgotPasswordOpen(true)}
                  className="text-xs text-white/60 transition hover:text-white"
                >
                  {t("auth.passwordForm.forgotPassword")}
                </button>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                <p className="text-xs leading-snug text-red-300">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !email.trim() || !password}
              className="flex h-11 w-full items-center justify-center rounded-lg bg-white text-sm font-semibold text-black shadow-sm transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "sign-in" ? (
                t("auth.passwordForm.signIn")
              ) : (
                t("auth.passwordForm.createAccountButton")
              )}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
              {t("auth.common.or")}
            </span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <button
            type="button"
            onClick={() => handleSocialSignIn("google")}
            disabled={isSocialLoading !== null || isSubmitting}
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm font-medium text-white/90 transition hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-50"
          >
            {isSocialLoading === "google" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <GoogleIcon className="h-4 w-4" />
                {t("auth.social.continueWithGoogle")}
              </>
            )}
          </button>

          <p className="mt-7 text-center text-xs text-white/50">
            {mode === "sign-in"
              ? t("auth.passwordForm.newHere")
              : t("auth.passwordForm.haveAccount")}{" "}
            <button
              type="button"
              onClick={toggleMode}
              className="font-semibold text-white transition hover:underline"
            >
              {mode === "sign-in"
                ? t("auth.passwordForm.createAccountLink")
                : t("auth.passwordForm.signInLink")}
            </button>
          </p>

          {onContinueWithoutAccount && (
            <button
              type="button"
              onClick={onContinueWithoutAccount}
              className="mt-3 w-full text-center text-xs text-white/35 transition hover:text-white/60"
            >
              {t("auth.emailStep.continueWithoutAccount")}
            </button>
          )}
        </div>
      </div>

      {/* Right — brand visual */}
      <div className="relative hidden p-3 lg:block lg:w-[54%]">
        <BrandVisual />
      </div>
    </div>
  );
}

/** Small centered shell for the auth edge-states (dark, matches the login). */
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#08080b] px-8 text-white">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center justify-center gap-2.5">
      <img src={logoIcon} alt="Pyper" className="h-8 w-8 rounded-[9px]" />
      <span className="text-lg font-semibold tracking-tight text-white">Pyper</span>
    </div>
  );
}

/** Right-side visual panel — an abstract, brand-coloured "voice" scene (all CSS/SVG). */
function BrandVisual() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/5">
      <div className="absolute inset-0 bg-gradient-to-br from-[#1b2a6b] via-[#0d1130] to-[#050510]" />
      {/* soft glow */}
      <div className="absolute left-1/2 top-[42%] h-[60%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#3b5bff]/25 blur-[90px]" />
      {/* concentric "sound" rings */}
      <svg
        className="absolute left-1/2 top-[42%] h-[68%] w-auto -translate-x-1/2 -translate-y-1/2"
        viewBox="0 0 400 400"
        fill="none"
      >
        {[190, 150, 110, 70].map((r, i) => (
          <circle
            key={r}
            cx="200"
            cy="200"
            r={r}
            stroke="white"
            strokeOpacity={0.06 + i * 0.05}
            strokeWidth="1.5"
          />
        ))}
        <circle cx="200" cy="200" r="34" fill="white" fillOpacity="0.9" />
        {/* mic bars */}
        <g stroke="#0d1130" strokeWidth="7" strokeLinecap="round">
          <path d="M200 184v32" />
          <path d="M186 192v16" />
          <path d="M214 192v16" />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-0 p-10">
        <p className="text-2xl font-semibold leading-tight tracking-tight text-white">
          Your voice, everywhere.
        </p>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/55">
          Privacy-first dictation that types into any app — the moment you speak.
        </p>
      </div>
    </div>
  );
}
