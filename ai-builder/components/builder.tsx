"use client";

import dynamic from "next/dynamic";
import {
  ArrowDownToLine,
  ArrowUp,
  Check,
  Camera,
  Code2,
  CreditCard,
  Eye,
  FileCode2,
  ImagePlus,
  LoaderCircle,
  Mic,
  MessageSquare,
  Monitor,
  PanelLeftClose,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  SandpackPreview,
  SandpackProvider,
} from "@codesandbox/sandpack-react";
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-slate-500">
      Loading editor…
    </div>
  ),
});

type ProjectFile = {
  path: string;
  content: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  kind?: "proposal" | "files" | "error";
  images?: Array<{ name: string; previewUrl: string }>;
};

type ImageAttachment = {
  id: string;
  name: string;
  mimeType: "image/jpeg";
  data: string;
  previewUrl: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type ProviderResponse =
  | { status: "proposal"; message: string }
  | {
      status: "files";
      message: string;
      files: ProjectFile[];
      dependencies?: Record<string, string>;
    };

type Panel = "chat" | "code" | "preview";

const starterFiles: ProjectFile[] = [
  {
    path: "/App.tsx",
    content: `import "./styles.css";

export default function App() {
  return (
    <main className="starter">
      <span className="eyebrow">PHOLLET BUILDER</span>
      <h1>Your next idea<br /><span>starts here.</span></h1>
      <p>Describe a website in the chat and review the proposal before generating its code.</p>
      <button type="button">Explore the preview <span aria-hidden="true">→</span></button>
    </main>
  );
}
`,
  },
  {
    path: "/styles.css",
    content: `@import url("https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap");

* { box-sizing: border-box; }
body { margin: 0; font-family: "DM Sans", sans-serif; color: #17211b; }
.starter { min-height: 100vh; display: grid; align-content: center; justify-items: start; gap: 20px; padding: clamp(32px, 8vw, 100px); background: radial-gradient(circle at 80% 12%, #dff5e6, transparent 30%), #fbfdfb; }
.eyebrow { color: #31845b; font-size: 12px; font-weight: 800; letter-spacing: .18em; }
h1 { margin: 0; font-size: clamp(48px, 8vw, 88px); line-height: .98; letter-spacing: -.07em; }
h1 span { color: #389664; }
p { max-width: 440px; margin: 0; color: #6e7a72; font-size: 17px; line-height: 1.7; }
button { padding: 14px 18px; border: 0; border-radius: 12px; background: #23774d; color: white; font-weight: 700; cursor: pointer; }
`,
  },
];

const suggestedPrompts = [
  "Design a modern storefront for a local clothing brand",
  "Create a clean SaaS dashboard with charts and navigation",
  "Build a Khmer restaurant landing page with a menu",
];

function codeLanguage(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "tsx" || extension === "ts") return "typescript";
  if (extension === "css") return "css";
  if (extension === "json") return "json";
  if (extension === "md") return "markdown";
  return "javascript";
}

function panelVisibility(panel: Panel, selected: Panel) {
  return `${panel === selected ? "flex" : "hidden"} min-h-0 flex-col md:flex`;
}

async function normalizeImage(file: File): Promise<ImageAttachment> {
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 10 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the selected image.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("The selected image could not be prepared."))),
        "image/jpeg",
        0.82,
      );
    });
    if (blob.size > 1_572_864) {
      throw new Error("The prepared image is too large. Choose a smaller image.");
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }

    return {
      id: crypto.randomUUID(),
      name: file.name.slice(0, 120) || "image.jpg",
      mimeType: "image/jpeg",
      data: btoa(binary),
      previewUrl: URL.createObjectURL(blob),
    };
  } finally {
    bitmap.close();
  }
}

export default function Builder() {
  const [files, setFiles] = useState<ProjectFile[]>(starterFiles);
  const [dependencies, setDependencies] = useState<Record<string, string>>({});
  const [activePath, setActivePath] = useState(starterFiles[0].path);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Describe the website you want to build. I’ll propose a structure, visual direction, and key features first; code generation starts after you approve.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mobilePanel, setMobilePanel] = useState<Panel>("chat");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [processingImages, setProcessingImages] = useState(false);
  const [listening, setListening] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "signedOut" | "signedIn" | "needsPro">("checking");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const settingsDialogRef = useRef<HTMLElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const imageUrlsRef = useRef(new Set<string>());
  const imageTaskIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const verificationToken = new URL(window.location.href).searchParams.get("verify");
    const verification = verificationToken
      ? fetch(`/api/auth?verify=${encodeURIComponent(verificationToken)}`, {
          cache: "no-store",
          signal: controller.signal,
        }).then(async (response) => {
          const body = await response.text();
          let result: unknown;
          try {
            result = body ? JSON.parse(body) : null;
          } catch {
            throw new Error("The email verification service returned an invalid response.");
          }
          if (!response.ok) {
            const message =
              typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
                ? result.error
                : "Could not verify this email.";
            throw new Error(message);
          }
          setAuthNotice("Email verified. Sign in to continue.");
          window.history.replaceState({}, "", window.location.pathname);
        })
      : Promise.resolve();
    void verification.then(() => fetch("/api/auth", { cache: "no-store", signal: controller.signal }))
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.text();
          let result: unknown;
          try {
            result = body ? JSON.parse(body) : null;
          } catch {
            throw new Error("The account service returned an invalid response.");
          }
          const message =
            typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
              ? result.error
              : "Account service is unavailable.";
          throw new Error(message);
        }
        const result = await response.json();
        if (typeof result !== "object" || result === null || !("authenticated" in result) || result.authenticated !== true) {
          return "signedOut" as const;
        }
        return "subscription" in result && result.subscription ? "signedIn" as const : "needsPro" as const;
      })
      .then((nextState) => setAuthState(nextState))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setAuthError(cause instanceof Error ? cause.message : "Could not verify Builder access.");
        setAuthState("signedOut");
      });
    return () => controller.abort();
  }, []);

  useEffect(
    () => () => {
      for (const url of imageUrlsRef.current) URL.revokeObjectURL(url);
      recognitionRef.current?.stop();
    },
    [],
  );

  useEffect(() => {
    if (!settingsOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    settingsCloseRef.current?.focus();

    function handleDialogKeydown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = settingsDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeydown);
    return () => {
      document.removeEventListener("keydown", handleDialogKeydown);
      previouslyFocused?.focus();
    };
  }, [settingsOpen]);

  const activeFile = files.find((file) => file.path === activePath) ?? files[0];
  const previewFiles = useMemo(
    () =>
      Object.fromEntries(
        files.map(({ path, content }) => [path, { code: content }]),
      ),
    [files],
  );

  function updateFile(path: string, content: string) {
    setFiles((current) =>
      current.map((file) => (file.path === path ? { ...file, content } : file)),
    );
  }

  function releaseImageUrl(url: string) {
    URL.revokeObjectURL(url);
    imageUrlsRef.current.delete(url);
  }

  async function addImageFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length === 0) return;

    const availableSlots = 2 - attachments.length;
    if (availableSlots <= 0) {
      setError("You can attach up to two images per prompt.");
      return;
    }

    setProcessingImages(true);
    setError("");
    const prepared: ImageAttachment[] = [];
    const taskId = ++imageTaskIdRef.current;
    try {
      for (const file of selected.slice(0, availableSlots)) {
        const image = await normalizeImage(file);
        prepared.push(image);
        imageUrlsRef.current.add(image.previewUrl);
      }

      if (taskId !== imageTaskIdRef.current) {
        for (const image of prepared) releaseImageUrl(image.previewUrl);
        return;
      }
      const newTotal = [...attachments, ...prepared].reduce(
        (total, image) => total + Math.ceil(image.data.length * 0.75),
        0,
      );
      if (newTotal > 2 * 1024 * 1024) {
        throw new Error("The combined image upload must be smaller than 2 MB.");
      }
      setAttachments((current) => [...current, ...prepared]);
    } catch (cause) {
      for (const image of prepared) releaseImageUrl(image.previewUrl);
      const message = cause instanceof Error ? cause.message : "Could not prepare the selected image.";
      setError(message);
    } finally {
      if (taskId === imageTaskIdRef.current) setProcessingImages(false);
    }
  }

  function removeImage(imageId: string) {
    setAttachments((current) => {
      const removed = current.find((image) => image.id === imageId);
      if (removed) releaseImageUrl(removed.previewUrl);
      return current.filter((image) => image.id !== imageId);
    });
  }

  function clearWorkspace() {
    imageTaskIdRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setProcessingImages(false);
    setBusy(false);
    for (const url of imageUrlsRef.current) URL.revokeObjectURL(url);
    imageUrlsRef.current.clear();
    setAttachments([]);
    setFiles(starterFiles);
    setDependencies({});
    setActivePath(starterFiles[0].path);
    setMessages((current) => current.slice(0, 1));
    setError("");
    setSettingsOpen(false);
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: authMode, email: authEmail, password: authPassword }),
      });
      const body = await response.text();
      let data: unknown;
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        throw new Error("The account service returned an invalid response.");
      }
      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not continue.";
        throw new Error(message);
      }
      if (
        authMode === "register" &&
        typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
      ) {
        setAuthNotice(data.message);
        setAuthMode("login");
        setAuthPassword("");
        return;
      }
      setAuthPassword("");
      setAuthNotice("");
      setAuthState(
        typeof data === "object" && data !== null && "subscription" in data && data.subscription
          ? "signedIn"
          : "needsPro",
      );
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Could not continue.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    try {
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not securely end this session. Try again.");
      clearWorkspace();
      setAuthState("signedOut");
      setSettingsOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not securely end this session.");
    }
  }

  function toggleVoiceInput() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Voice input is not supported in this browser. Try a recent version of Chrome or Edge.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      if (transcript) setDraft((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" ? "Allow microphone access in your browser to use voice input." : "Voice input could not be completed.");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    try {
      recognitionRef.current = recognition;
      recognition.start();
      setError("");
      setListening(true);
    } catch {
      setError("Could not start voice input. Check microphone permissions and try again.");
      recognitionRef.current = null;
    }
  }

  async function sendMessage(text = draft) {
    const value = text.trim();
    if ((!value && attachments.length === 0) || busy || processingImages) return;

    const prompt = value || "Please inspect the attached image and use it as a reference for the project.";
    const outgoingImages = attachments;
    const conversation: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: prompt,
        images: outgoingImages.map(({ name, previewUrl }) => ({ name, previewUrl })),
      },
    ];
    setMessages(conversation);
    setDraft("");
    setAttachments([]);
    setBusy(true);
    setError("");
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: conversation.map(({ role, content, kind }) => ({ role, content, kind })),
          images: outgoingImages.map(({ mimeType, data }) => ({ mimeType, data })),
        }),
      });

      const body = await response.text();
      let data: unknown;
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        throw new Error("The server returned an invalid response.");
      }
      if (!response.ok) {
        const detail =
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : `Request failed with HTTP ${response.status}.`;
        throw new Error(detail);
      }
      if (
        typeof data !== "object" ||
        data === null ||
        !("status" in data) ||
        !("message" in data) ||
        typeof data.message !== "string"
      ) {
        throw new Error("The AI response did not match the expected project format.");
      }

      const result = data as ProviderResponse;
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.message,
          kind: result.status,
        },
      ]);

      if (result.status === "files") {
        setFiles(result.files);
        setDependencies(result.dependencies ?? {});
        setActivePath(result.files.some((file) => file.path === activePath) ? activePath : result.files[0].path);
        setMobilePanel("preview");
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : "Project generation failed.";
      setError(message);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: message, kind: "error" },
      ]);
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  if (authState === "needsPro") {
    return (
      <main className="grid h-dvh place-items-center bg-[#0b0e12] px-5 text-slate-100">
        <section className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[#101419] p-6 text-center shadow-2xl">
          <div className="mx-auto grid size-11 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
            <Sparkles size={21} />
          </div>
          <h1 className="text-lg font-semibold">Choose Phollet AI Pro</h1>
          <p className="text-sm leading-6 text-slate-400">
            Your verified account needs an active Pro plan to use project generation. Checkout is one payment per term and does not auto-renew.
          </p>
          <Link
            href="/pricing"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400"
          >
            View plans and pay with ABA KHQR
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.06]"
          >
            Sign out
          </button>
        </section>
      </main>
    );
  }

  if (authState !== "signedIn") {
    return (
      <main className="grid h-dvh place-items-center bg-[#0b0e12] px-5 text-slate-100">
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <form
            onSubmit={submitLogin}
            className="w-full space-y-5 rounded-2xl border border-white/10 bg-[#101419] p-6 shadow-2xl"
          >
            <div className="grid size-11 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
              <ShieldCheck size={21} />
            </div>
            <div>
              <h1 className="text-lg font-semibold">{authMode === "login" ? "Sign in to Phollet Builder" : "Create your Phollet account"}</h1>
              <p className="mt-1 text-sm leading-6 text-slate-400">Email verification is required before account access and payment.</p>
            </div>
            {authState === "checking" ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <LoaderCircle size={15} className="animate-spin" />
                Checking secure access…
              </div>
            ) : (
              <>
                <label className="block space-y-2 text-xs text-slate-300">
                  Email address
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0b0e12] px-3 py-2.5 text-sm outline-none focus:border-emerald-400/50"
                  />
                </label>
                <label className="block space-y-2 text-xs text-slate-300">
                  Password {authMode === "register" && <span className="text-slate-500">(at least 12 characters)</span>}
                  <input
                    type="password"
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    required
                    maxLength={256}
                    minLength={authMode === "register" ? 12 : 1}
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0b0e12] px-3 py-2.5 text-sm outline-none focus:border-emerald-400/50"
                  />
                </label>
                {authNotice && <p role="status" className="text-xs leading-5 text-emerald-200">{authNotice}</p>}
                {authError && <p role="alert" className="text-xs text-rose-300">{authError}</p>}
                <button
                  type="submit"
                  disabled={authBusy || !authPassword}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
                >
                  {authBusy && <LoaderCircle size={15} className="animate-spin" />}
                  {authMode === "login" ? "Sign in" : "Create account"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode((current) => current === "login" ? "register" : "login");
                    setAuthError("");
                    setAuthNotice("");
                  }}
                  className="w-full text-xs text-slate-400 hover:text-emerald-200"
                >
                  {authMode === "login" ? "New here? Create an account" : "Already registered? Sign in"}
                </button>
              </>
            )}
          </form>
          <Link href="/pricing" className="text-xs font-medium text-emerald-300 hover:text-emerald-200">
            View Pro pricing
          </Link>
        </div>
      </main>
    );
  }

  function handleComposerKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-[#0b0e12] text-slate-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#101419] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300">
            <WandSparkles size={17} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Phollet Builder</div>
            <div className="hidden text-[11px] text-slate-500 sm:block">AI project workspace</div>
          </div>
          <span className="ml-2 hidden items-center gap-1.5 rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-slate-400 sm:inline-flex">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            React sandbox
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.06]"
          >
            <CreditCard size={14} />
            <span className="hidden sm:inline">Pricing</span>
          </Link>
          <button
            type="button"
            onClick={clearWorkspace}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.06]"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">New project</span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings and privacy"
            title="Settings and privacy"
            className="grid size-9 place-items-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/[0.06]"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <nav className="grid h-11 shrink-0 grid-cols-3 border-b border-white/[0.08] bg-[#101419] md:hidden">
        {([
          ["chat", MessageSquare, "Chat"],
          ["code", Code2, "Code"],
          ["preview", Eye, "Preview"],
        ] as const).map(([panel, Icon, label]) => (
          <button
            key={panel}
            type="button"
            onClick={() => setMobilePanel(panel)}
            className={`flex items-center justify-center gap-2 border-b-2 text-xs ${mobilePanel === panel ? "border-emerald-400 text-emerald-300" : "border-transparent text-slate-500"}`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-white/[0.08] md:grid-cols-[300px_minmax(300px,0.9fr)_minmax(360px,1.1fr)] md:divide-x md:divide-y-0">
        <section className={panelVisibility("chat", mobilePanel)}>
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <MessageSquare size={14} className="text-slate-500" />
              Agent chat
            </div>
            <PanelLeftClose size={15} className="text-slate-600" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
            {messages.map((message, index) => (
              <article key={`${index}-${message.role}`} className="flex gap-3">
                <div
                  className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${message.role === "assistant" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700 text-slate-200"}`}
                >
                  {message.role === "assistant" ? <Sparkles size={14} /> : <span className="text-[10px] font-bold">YOU</span>}
                </div>
                <div className="min-w-0 flex-1">
                  {message.kind && (
                    <div
                      className={`mb-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${message.kind === "proposal" ? "bg-amber-400/10 text-amber-300" : message.kind === "error" ? "bg-rose-400/10 text-rose-300" : "bg-emerald-400/10 text-emerald-300"}`}
                    >
                      {message.kind === "proposal" ? "Proposal" : message.kind === "error" ? "Error" : "Project updated"}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap text-[13px] leading-6 text-slate-300">{message.content}</p>
                  {message.images && message.images.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {message.images.map((image, imageIndex) => (
                        <img
                          key={`${image.name}-${imageIndex}`}
                          src={image.previewUrl}
                          alt={image.name}
                          className="size-16 rounded-lg border border-white/10 object-cover"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
            {busy && (
              <div className="flex items-center gap-2 pl-10 text-xs text-slate-500">
                <LoaderCircle size={14} className="animate-spin" />
                Preparing your project…
              </div>
            )}
            {messages.length === 1 && (
              <div className="mt-2 space-y-2 pl-10">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-600">Try a prompt</div>
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    disabled={busy}
                    className="block w-full rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left text-xs leading-5 text-slate-400 hover:border-emerald-400/30 hover:text-slate-200 disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={submit} className="shrink-0 border-t border-white/[0.07] p-3">
            {error && <p className="mb-2 px-1 text-xs text-rose-300">{error}</p>}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={addImageFiles}
              aria-label="Choose images"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={addImageFiles}
              aria-label="Capture an image"
            />
            <div className="rounded-xl border border-white/[0.12] bg-[#151a20] p-2 focus-within:border-emerald-400/50">
              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
                  {attachments.map((image) => (
                    <div key={image.id} className="relative size-14">
                      <img
                        src={image.previewUrl}
                        alt={`Preview: ${image.name}`}
                        className="size-14 rounded-lg border border-white/10 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(image.id)}
                        aria-label={`Remove ${image.name}`}
                        className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-slate-700 text-white hover:bg-rose-500"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKey}
                placeholder="Describe an idea, or attach an image…"
                rows={3}
                maxLength={16000}
                className="w-full resize-none bg-transparent px-1 py-1 text-[13px] leading-5 text-slate-200 outline-none placeholder:text-slate-600"
              />
              <div className="flex items-center justify-between pt-1">
                <div className="flex min-w-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={busy || processingImages || attachments.length >= 2}
                    aria-label="Attach an image"
                    title="Attach an image"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
                  >
                    <ImagePlus size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={busy || processingImages || attachments.length >= 2}
                    aria-label="Capture or upload an image"
                    title="Capture or upload an image"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
                  >
                    <Camera size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={toggleVoiceInput}
                    disabled={busy}
                    aria-label={listening ? "Stop voice input" : "Start voice input"}
                    aria-pressed={listening}
                    title={listening ? "Stop voice input" : "Start voice input"}
                    className={`grid size-8 shrink-0 place-items-center rounded-lg hover:bg-white/[0.06] disabled:opacity-40 ${listening ? "text-rose-300" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    <Mic size={16} />
                  </button>
                  <span className="hidden px-1 text-[10px] text-slate-600 xl:inline">Enter to send</span>
                </div>
                <button
                  type="submit"
                  disabled={busy || processingImages || (!draft.trim() && attachments.length === 0)}
                  className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500 text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Send prompt"
                >
                  {busy || processingImages ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUp size={16} />}
                </button>
              </div>
            </div>
            {processingImages && <p className="mt-1 px-1 text-[10px] text-slate-500">Preparing images securely…</p>}
          </form>
        </section>

        <section className={panelVisibility("code", mobilePanel)}>
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Code2 size={14} className="text-slate-500" />
              Code editor
            </div>
            <span className="text-[10px] text-slate-600">TypeScript · React</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.07] bg-[#0e1217] px-2 py-1.5">
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setActivePath(file.path)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] ${activePath === file.path ? "bg-white/[0.08] text-slate-100" : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"}`}
              >
                <FileCode2 size={12} />
                {file.path}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {activeFile ? (
              <Editor
                height="100%"
                path={activeFile.path}
                language={codeLanguage(activeFile.path)}
                value={activeFile.content}
                onChange={(value) => updateFile(activeFile.path, value ?? "")}
                theme="vs-dark"
                options={{
                  automaticLayout: true,
                  fontSize: 13,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  padding: { top: 16, bottom: 16 },
                  tabSize: 2,
                }}
              />
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-500">No project files yet</div>
            )}
          </div>
        </section>

        <section className={panelVisibility("preview", mobilePanel)}>
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Eye size={14} className="text-slate-500" />
              Live preview
            </div>
            <div className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
              <Monitor size={13} />
              <span>Sandboxed</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 bg-white">
            <SandpackProvider
              template="react-ts"
              files={previewFiles}
              customSetup={{ dependencies }}
              options={{
                autorun: true,
                recompileMode: "immediate",
                externalResources: ["https://cdn.tailwindcss.com"],
              }}
            >
              <div className="sandpack h-full">
                <SandpackPreview
                  showOpenInCodeSandbox={false}
                  showRefreshButton
                  showNavigator
                  style={{ height: "100%" }}
                />
              </div>
            </SandpackProvider>
          </div>
          <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/[0.07] bg-[#101419] px-3 text-[10px] text-slate-600">
            <span>{files.length} files · preview refreshes as you edit</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-slate-300"
              onClick={() => {
                const content = JSON.stringify({ files, dependencies }, null, 2);
                const blob = new Blob([content], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "phollet-project.json";
                anchor.click();
                URL.revokeObjectURL(url);
              }}
            >
              <ArrowDownToLine size={12} />
              Export project JSON
            </button>
          </div>
        </section>
      </div>
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            ref={settingsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#11171d] p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="settings-title" className="text-base font-semibold text-slate-100">Settings &amp; privacy</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">Manage this private Builder session and understand how your data is handled.</p>
              </div>
              <button
                ref={settingsCloseRef}
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white"
              >
                <X size={17} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <ShieldCheck size={14} className="text-emerald-300" />
                  Data &amp; privacy
                </h3>
                <ul className="mt-2 space-y-2 text-xs leading-5 text-slate-400">
                  <li>Chat, images, and generated files are held in this browser tab and are not saved by this app to a database.</li>
                  <li>Prompts and attached images are sent to the configured AI provider to answer your request. The provider’s own data policies apply.</li>
                  <li>Images are resized and re-encoded before upload to reduce size and remove embedded metadata. Only JPEG, PNG, and WebP inputs are accepted.</li>
                  <li>Voice transcription uses your browser’s speech service; audio is not sent to this Builder API, but browser-provider handling may vary.</li>
                </ul>
              </section>

              <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                <h3 className="text-xs font-semibold text-slate-200">Credentials &amp; access</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  AI keys stay on the server in environment variables and are never requested by this page. Access uses a shared administrator password; do not share this workspace publicly or include secrets in prompts or generated code.
                </p>
              </section>

              <div className="flex flex-col-reverse gap-2 border-t border-white/[0.08] pt-4 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={clearWorkspace}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 hover:border-rose-400/30 hover:text-rose-200"
                >
                  <Trash2 size={14} />
                  Clear workspace data
                </button>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="rounded-lg bg-white/[0.08] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.12]"
                >
                  Sign out
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
