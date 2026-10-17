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
import { FREE_TRIAL_PROJECT_LIMIT } from "@/lib/payments/plans";

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

type SavedProjectSummary = {
  id: string;
  isTrial: boolean;
  updatedAt: string;
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

type StoredOnboardingDraft = {
  prompt: string;
  images: Array<Pick<ImageAttachment, "id" | "name" | "mimeType" | "data">>;
};

const ONBOARDING_DRAFT_STORAGE_KEY = "phollet-builder-onboarding-v1";
const MAX_PROMPT_IMAGES = 4;
const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_ONBOARDING_SESSION_CHARS = 2_400_000;

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
      projectId: string;
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

function isSavedProject(value: unknown): value is {
  id: string;
  files: ProjectFile[];
  dependencies: Record<string, string>;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "files" in value &&
    Array.isArray(value.files) &&
    value.files.every(
      (file) =>
        typeof file === "object" &&
        file !== null &&
        "path" in file &&
        typeof file.path === "string" &&
        "content" in file &&
        typeof file.content === "string",
    ) &&
    "dependencies" in value &&
    typeof value.dependencies === "object" &&
    value.dependencies !== null &&
    !Array.isArray(value.dependencies) &&
    Object.values(value.dependencies).every((dependency) => typeof dependency === "string")
  );
}

function isSavedProjectList(value: unknown): value is { projects: SavedProjectSummary[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "projects" in value &&
    Array.isArray(value.projects) &&
    value.projects.every(
      (project) =>
        typeof project === "object" &&
        project !== null &&
        "id" in project &&
        typeof project.id === "string" &&
        "isTrial" in project &&
        typeof project.isTrial === "boolean" &&
        "updatedAt" in project &&
        typeof project.updatedAt === "string",
    )
  );
}

async function normalizeImage(file: File): Promise<ImageAttachment> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > 10 * 1024 * 1024) {
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

function parseStoredOnboardingDraft(value: unknown): StoredOnboardingDraft | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("prompt" in value) ||
    typeof value.prompt !== "string" ||
    value.prompt.length > 4000 ||
    !("images" in value) ||
    !Array.isArray(value.images) ||
    value.images.length > MAX_PROMPT_IMAGES
  ) {
    return null;
  }
  let totalBytes = 0;
  const images: StoredOnboardingDraft["images"] = [];
  for (const image of value.images) {
    if (
      typeof image !== "object" ||
      image === null ||
      !("id" in image) ||
      typeof image.id !== "string" ||
      image.id.length > 100 ||
      !("name" in image) ||
      typeof image.name !== "string" ||
      image.name.length > 120 ||
      !("mimeType" in image) ||
      image.mimeType !== "image/jpeg" ||
      !("data" in image) ||
      typeof image.data !== "string" ||
      image.data.length > 2_800_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)
    ) {
      return null;
    }
    const bytes = Math.floor(image.data.length * 0.75) - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
    totalBytes += bytes;
    if (bytes <= 0 || bytes > 1_572_864 || totalBytes > MAX_IMAGE_UPLOAD_BYTES) return null;
    images.push({
      id: image.id,
      name: image.name.slice(0, 120),
      mimeType: "image/jpeg",
      data: image.data,
    });
  }
  return { prompt: value.prompt, images };
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
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<Panel>("chat");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [processingImages, setProcessingImages] = useState(false);
  const [listening, setListening] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "signedOut" | "signedIn">("checking");
  const [isPro, setIsPro] = useState(false);
  const [trialProjectCount, setTrialProjectCount] = useState(0);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [savedProjects, setSavedProjects] = useState<SavedProjectSummary[]>([]);
  const [landingPrompt, setLandingPrompt] = useState("");
  const [landingAttachmentError, setLandingAttachmentError] = useState("");
  const [cameraUploadFallback, setCameraUploadFallback] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraCapture, setCameraCapture] = useState<File | null>(null);
  const [cameraCaptureUrl, setCameraCaptureUrl] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const landingImageInputRef = useRef<HTMLInputElement>(null);
  const landingCameraInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const firstAttachmentMenuItemRef = useRef<HTMLButtonElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraCaptureUrlRef = useRef("");
  const cameraRequestIdRef = useRef(0);
  const attachmentButtonRef = useRef<HTMLButtonElement>(null);
  const accountSectionRef = useRef<HTMLElement>(null);
  const settingsDialogRef = useRef<HTMLElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const imageUrlsRef = useRef(new Set<string>());
  const imageTaskIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  function persistOnboardingDraft(prompt: string, images: ImageAttachment[]) {
    try {
      if (!prompt && images.length === 0) {
        window.sessionStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
        return true;
      }
      const serialized = JSON.stringify({
        prompt,
        images: images.map(({ id, name, mimeType, data }) => ({ id, name, mimeType, data })),
      } satisfies StoredOnboardingDraft);
      if (serialized.length > MAX_ONBOARDING_SESSION_CHARS) {
        setLandingAttachmentError("These attachments are too large to keep through sign-in. Remove an image and try again.");
        return false;
      }
      window.sessionStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, serialized);
      return true;
    } catch {
      setLandingAttachmentError("This browser could not save your attachments for sign-in. You can still upload them after signing in.");
      return false;
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    try {
      const savedPrompt = window.sessionStorage.getItem("phollet-builder-onboarding-prompt");
      if (savedPrompt) {
        setDraft(savedPrompt);
        setLandingPrompt(savedPrompt);
      }
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    }
    try {
      const serialized = window.sessionStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
      if (serialized) {
        if (serialized.length > MAX_ONBOARDING_SESSION_CHARS) {
          throw new Error("Saved onboarding data exceeded its size limit.");
        }
        const savedDraft = parseStoredOnboardingDraft(JSON.parse(serialized));
        if (!savedDraft) {
          window.sessionStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
          setLandingAttachmentError("Saved image attachments could not be restored. Please attach them again.");
        } else {
          const restoredImages = savedDraft.images.map((image) => {
            const binary = atob(image.data);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
              bytes[index] = binary.charCodeAt(index);
            }
            const previewUrl = URL.createObjectURL(
              new Blob([bytes], { type: image.mimeType }),
            );
            imageUrlsRef.current.add(previewUrl);
            return { ...image, previewUrl };
          });
          setLandingPrompt(savedDraft.prompt);
          setDraft(savedDraft.prompt);
          setAttachments(restoredImages);
        }
      }
    } catch {
      try {
        window.sessionStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
      } catch {
        // Storage may be unavailable in private or restricted contexts.
      }
      setLandingAttachmentError("Saved image attachments could not be restored. Please attach them again.");
    }
    const pageUrl = new URL(window.location.href);
    const verificationToken = pageUrl.searchParams.get("verify");
    const googleError = pageUrl.searchParams.get("auth_error");
    const googleErrors: Record<string, string> = {
      google_not_configured: "Google sign-in is not fully configured. Please contact the administrator.",
      google_unavailable: "Google sign-in could not start. Please try again.",
      google_domain_mismatch: "Google sign-in was started on a different domain. Use the canonical site address or align BUILDER_PUBLIC_URL with the authorized Google callback URL.",
      google_cancelled: "Google sign-in was cancelled. You can try again or use email.",
      google_invalid: "This Google sign-in link expired or could not be verified. Please try again.",
      google_failed: "Google could not verify your account. Please try again.",
      google_configuration_error: "Google OAuth rejected this app configuration. Confirm the client ID, client secret, and exact callback URL in Google Cloud Console and Vercel.",
      google_unverified: "Google did not confirm this email address. Verify it with Google and try again.",
      google_account_conflict: "This email already belongs to a separate account. Sign in with its original method or contact support.",
      database_not_configured: "Account storage is not configured. Please contact the administrator.",
      database_unavailable: "The account database is temporarily unreachable. Please try again shortly.",
      service_unavailable: "Account service is temporarily unavailable. Please try again shortly.",
    };
    if (googleError) {
      setAuthError(googleErrors[googleError] ?? "Google sign-in could not be completed. Please try again.");
      pageUrl.searchParams.delete("auth_error");
      window.history.replaceState({}, "", `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
    }
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
        const result: unknown = await response.json();
        if (typeof result !== "object" || result === null || !("authenticated" in result) || result.authenticated !== true) {
          return "signedOut" as const;
        }
        if ("email" in result && typeof result.email === "string") setAuthEmail(result.email);
        const subscription = "subscription" in result ? result.subscription : null;
        setIsPro(Boolean(subscription));
        if ("trialProjectCount" in result && typeof result.trialProjectCount === "number") {
          setTrialProjectCount(result.trialProjectCount);
        }
        const recentProjectId =
          "recentProjectId" in result && typeof result.recentProjectId === "string"
            ? result.recentProjectId
            : null;
        const projectsResponse = await fetch("/api/projects", {
          cache: "no-store",
          signal: controller.signal,
        });
        const projectsBody = await projectsResponse.text();
        let projectsData: unknown;
        try {
          projectsData = projectsBody ? JSON.parse(projectsBody) : null;
        } catch {
          throw new Error("The saved projects service returned an invalid response.");
        }
        if (!projectsResponse.ok || !isSavedProjectList(projectsData)) {
          throw new Error("Could not load your saved projects. Please reload and try again.");
        }
        setSavedProjects(projectsData.projects);
        if (recentProjectId) {
          const projectResponse = await fetch(`/api/projects?id=${encodeURIComponent(recentProjectId)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const projectBody = await projectResponse.text();
          let projectData: unknown;
          try {
            projectData = projectBody ? JSON.parse(projectBody) : null;
          } catch {
            throw new Error("The saved project service returned an invalid response.");
          }
          if (!projectResponse.ok || !isSavedProject(projectData)) {
            throw new Error("Could not restore your saved project. Please reload and try again.");
          }
          setFiles(projectData.files);
          setDependencies(projectData.dependencies);
          setActivePath(projectData.files[0]?.path ?? starterFiles[0].path);
          setCurrentProjectId(projectData.id);
          setMessages((current) => [
            current[0],
            { role: "assistant", content: "Your most recent saved project has been restored.", kind: "files" },
          ]);
        }
        return "signedIn" as const;
      })
      .then((nextState) => setAuthState(nextState))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setAuthError(cause instanceof Error ? cause.message : "Could not verify Builder access.");
        setAuthState("signedOut");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (authState !== "signedIn") return;
    try {
      window.sessionStorage.removeItem("phollet-builder-onboarding-prompt");
      window.sessionStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
    } catch {
      // Storage cleanup is best effort; it contains no authentication credentials.
    }
  }, [authState]);

  useEffect(() => {
    const video = cameraVideoRef.current;
    if (!cameraStream || !video) return;
    video.srcObject = cameraStream;
    void video.play().catch(() => {
      setLandingAttachmentError("The camera preview could not start. Choose an image from your device instead.");
    });
    return () => {
      video.srcObject = null;
    };
  }, [cameraStream]);

  useEffect(
    () => () => {
      cameraRequestIdRef.current += 1;
      for (const track of cameraStreamRef.current?.getTracks() ?? []) track.stop();
      if (cameraCaptureUrlRef.current) URL.revokeObjectURL(cameraCaptureUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!attachmentMenuOpen) return;
    firstAttachmentMenuItemRef.current?.focus();

    function handleMenuKeydown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setAttachmentMenuOpen(false);
        attachmentButtonRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
        return;
      }
      const items = attachmentMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      if (!items?.length) return;
      event.preventDefault();
      const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (currentIndex + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      items[nextIndex].focus();
    }

    function handleOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !attachmentMenuRef.current?.contains(event.target)) {
        setAttachmentMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleMenuKeydown);
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => {
      document.removeEventListener("keydown", handleMenuKeydown);
      document.removeEventListener("pointerdown", handleOutsidePointer);
    };
  }, [attachmentMenuOpen]);

  useEffect(
    () => () => {
      for (const url of imageUrlsRef.current) URL.revokeObjectURL(url);
      recognitionRef.current?.stop();
    },
    [],
  );

  useEffect(() => {
    if (authState !== "signedIn" || !currentProjectId) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/projects", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: currentProjectId, files, dependencies }),
            cache: "no-store",
            signal: controller.signal,
          });
          const body = await response.text();
          let result: unknown;
          try {
            result = body ? JSON.parse(body) : null;
          } catch {
            throw new Error("The project save service returned an invalid response.");
          }
          if (!response.ok) {
            const message =
              typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
                ? result.error
                : `Could not save project changes (HTTP ${response.status}).`;
            if (response.status === 402) setPaywallOpen(true);
            throw new Error(message);
          }
        } catch (cause) {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Could not save project changes.");
        }
      })();
    }, 1500);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [authState, currentProjectId, files, dependencies]);

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

  async function processImageFiles(selected: File[]) {
    if (selected.length === 0) return;

    const availableSlots = MAX_PROMPT_IMAGES - attachments.length;
    if (availableSlots <= 0) {
      const message = "You can attach up to four images per prompt.";
      setError(message);
      setLandingAttachmentError(message);
      return;
    }

    setProcessingImages(true);
    setError("");
    setLandingAttachmentError("");
    setCameraUploadFallback(false);
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
      const nextAttachments = [...attachments, ...prepared];
      const newTotal = nextAttachments.reduce(
        (total, image) => total + Math.ceil(image.data.length * 0.75),
        0,
      );
      if (newTotal > MAX_IMAGE_UPLOAD_BYTES) {
        throw new Error("The combined image upload must be smaller than 2 MB.");
      }
      setAttachments(nextAttachments);
      if (authState !== "signedIn") {
        persistOnboardingDraft(landingPrompt, nextAttachments);
      }
      if (selected.length > availableSlots) {
        setLandingAttachmentError("Only the first four images can be attached to a prompt.");
      }
    } catch (cause) {
      for (const image of prepared) releaseImageUrl(image.previewUrl);
      const message = cause instanceof Error ? cause.message : "Could not prepare the selected image.";
      setError(message);
      setLandingAttachmentError(message);
    } finally {
      if (taskId === imageTaskIdRef.current) setProcessingImages(false);
    }
  }

  function addImageFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    void processImageFiles(selected);
  }

  function addLandingImageFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    void processImageFiles(selected);
  }

  function removeImage(imageId: string) {
    const removed = attachments.find((image) => image.id === imageId);
    if (removed) releaseImageUrl(removed.previewUrl);
    const remaining = attachments.filter((image) => image.id !== imageId);
    setAttachments(remaining);
    if (authState !== "signedIn") persistOnboardingDraft(landingPrompt, remaining);
  }

  function closeCamera() {
    cameraRequestIdRef.current += 1;
    setCameraStarting(false);
    for (const track of cameraStreamRef.current?.getTracks() ?? []) track.stop();
    cameraStreamRef.current = null;
    setCameraStream(null);
    setCameraCapture(null);
    if (cameraCaptureUrlRef.current) URL.revokeObjectURL(cameraCaptureUrlRef.current);
    cameraCaptureUrlRef.current = "";
    setCameraCaptureUrl("");
  }

  async function openCamera() {
    setAttachmentMenuOpen(false);
    setCameraUploadFallback(false);
    setLandingAttachmentError("");
    const mobileCapture =
      window.matchMedia("(max-width: 767px)").matches &&
      (navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches);
    if (mobileCapture) {
      landingCameraInputRef.current?.click();
      return;
    }
    const requestId = ++cameraRequestIdRef.current;
    setCameraStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
        throw new Error("Camera access is unavailable in this browser context.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment" },
      });
      if (requestId !== cameraRequestIdRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      cameraStreamRef.current = stream;
      setCameraStream(stream);
      setCameraCapture(null);
      setLandingAttachmentError("");
      setCameraUploadFallback(false);
    } catch {
      if (requestId !== cameraRequestIdRef.current) return;
      setLandingAttachmentError("Camera access is unavailable or denied. Choose an image from your device instead.");
      setCameraUploadFallback(true);
      landingImageInputRef.current?.click();
    } finally {
      if (requestId === cameraRequestIdRef.current) setCameraStarting(false);
    }
  }

  function captureCameraPhoto() {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setLandingAttachmentError("The camera is not ready yet. Please wait and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setLandingAttachmentError("This browser could not capture the camera image.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setLandingAttachmentError("The camera photo could not be captured. Please try again.");
          return;
        }
        if (cameraCaptureUrlRef.current) URL.revokeObjectURL(cameraCaptureUrlRef.current);
        const photo = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        cameraCaptureUrlRef.current = URL.createObjectURL(blob);
        setCameraCapture(photo);
        setCameraCaptureUrl(cameraCaptureUrlRef.current);
      },
      "image/jpeg",
      0.9,
    );
  }

  function retakeCameraPhoto() {
    setCameraCapture(null);
    if (cameraCaptureUrlRef.current) URL.revokeObjectURL(cameraCaptureUrlRef.current);
    cameraCaptureUrlRef.current = "";
    setCameraCaptureUrl("");
  }

  function useCameraPhoto() {
    if (!cameraCapture) return;
    const photo = cameraCapture;
    closeCamera();
    void processImageFiles([photo]);
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
    setLandingPrompt("");
    setLandingAttachmentError("");
    setCameraUploadFallback(false);
    setAttachmentMenuOpen(false);
    closeCamera();
    setFiles(starterFiles);
    setDependencies({});
    setActivePath(starterFiles[0].path);
    setCurrentProjectId(null);
    setMessages((current) => current.slice(0, 1));
    setError("");
    setPaywallOpen(false);
    setSettingsOpen(false);
  }

  function startOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = landingPrompt.trim();
    persistOnboardingDraft(prompt, attachments);
    if (prompt) {
      setDraft(prompt);
      try {
        window.sessionStorage.setItem("phollet-builder-onboarding-prompt", prompt);
      } catch {
        // The prompt can still be used in this page when storage is unavailable.
      }
    } else {
      setDraft("");
    }
    setAuthMode("register");
    setAuthNotice("");
    accountSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      if (
        typeof data !== "object" ||
        data === null ||
        !("authenticated" in data) ||
        data.authenticated !== true
      ) {
        throw new Error("The account service did not start a secure session.");
      }
      window.location.assign("/");
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
      try {
        window.sessionStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
        window.sessionStorage.removeItem("phollet-builder-onboarding-prompt");
      } catch {
        setLandingAttachmentError("You are signed out, but this browser could not clear the saved prompt data. Close this tab to remove it.");
      }
      setIsPro(false);
      setTrialProjectCount(0);
      setSavedProjects([]);
      setAuthEmail("");
      setAuthPassword("");
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
          ...(currentProjectId ? { projectId: currentProjectId } : {}),
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
        if (response.status === 402) setPaywallOpen(true);
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
        if (!result.projectId) throw new Error("The saved project response did not include its project identifier.");
        setFiles(result.files);
        setDependencies(result.dependencies ?? {});
        setCurrentProjectId(result.projectId);
        setSavedProjects((current) => {
          const existing = current.find((project) => project.id === result.projectId);
          const summary: SavedProjectSummary = {
            id: result.projectId,
            isTrial: existing?.isTrial ?? (!isPro && !currentProjectId),
            updatedAt: new Date().toISOString(),
          };
          return [summary, ...current.filter((project) => project.id !== result.projectId)];
        });
        if (!isPro && !currentProjectId) {
          setTrialProjectCount((count) => Math.min(count + 1, FREE_TRIAL_PROJECT_LIMIT));
        }
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

  async function openSavedProject(projectId: string) {
    try {
      const response = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
      });
      const body = await response.text();
      let data: unknown;
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        throw new Error("The saved project service returned an invalid response.");
      }
      if (!response.ok || !isSavedProject(data)) {
        const message =
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not open this project.";
        throw new Error(message);
      }
      requestControllerRef.current?.abort();
      setFiles(data.files);
      setDependencies(data.dependencies);
      setActivePath(data.files[0]?.path ?? starterFiles[0].path);
      setCurrentProjectId(data.id);
      setMessages([
        {
          role: "assistant",
          content: "Your saved project is open. Describe the changes you want to make.",
          kind: "files",
        },
      ]);
      setError("");
      setPaywallOpen(false);
      setMobilePanel("preview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open this project.");
    }
  }

  async function exportProject() {
    if (!currentProjectId) {
      setError("Generate a project before exporting it.");
      return;
    }
    setError("");
    try {
      const response = await fetch("/api/projects/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: currentProjectId, files, dependencies }),
        cache: "no-store",
      });
      const body = await response.text();
      if (!response.ok) {
        let data: unknown;
        try {
          data = body ? JSON.parse(body) : null;
        } catch {
          throw new Error("The export service returned an invalid response.");
        }
        const message =
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : `Export failed with HTTP ${response.status}.`;
        if (response.status === 402) setPaywallOpen(true);
        throw new Error(message);
      }
      if (!body) throw new Error("The export service returned an empty project.");
      const blob = new Blob([body], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "phollet-project.json";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export this project.");
    }
  }

  if (authState !== "signedIn") {
    return (
      <main className="min-h-dvh overflow-y-auto bg-[#0b0e12] text-slate-100">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-white/[0.08] bg-[#0b0e12]/90 px-5 backdrop-blur sm:px-8">
          <a href="#" className="flex items-center gap-2.5 font-semibold">
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
              <WandSparkles size={18} />
            </span>
            Phollet AI
          </a>
          <nav className="hidden items-center gap-7 text-sm text-slate-400 md:flex">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#plans" className="hover:text-white">Plans</a>
            <a href="#account" className="hover:text-white">How it works</a>
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                accountSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.06] sm:text-sm"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("register");
                accountSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-400 sm:text-sm"
            >
              Start for free
            </button>
          </div>
        </header>

        <section className="mx-auto max-w-5xl px-5 pb-16 pt-16 text-center sm:px-8 sm:pb-20 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-1.5 text-[11px] font-medium text-emerald-200">
            <Sparkles size={13} /> AI website builder · one free project
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">What will you build?</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
            Describe an idea, review a proposal, then generate and preview a React project. Start free—no payment details required.
          </p>
          <form
            onSubmit={startOnboarding}
            className="mx-auto mt-8 max-w-3xl rounded-2xl border border-white/10 bg-[#11171d] p-3 text-left shadow-2xl shadow-black/20 focus-within:border-emerald-300/40 sm:p-4"
          >
            <input
              ref={landingImageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={addLandingImageFiles}
              aria-label="Upload images / រូបភាព"
            />
            <input
              ref={landingCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={addLandingImageFiles}
              aria-label="Take a photo / ថតរូប"
            />
            <label htmlFor="landing-prompt" className="sr-only">Describe the project you want to build</label>
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1" aria-label="Attached images">
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
                      aria-label={`Remove ${image.name} / លុបរូបភាព`}
                      className="absolute -right-2 -top-2 grid size-11 place-items-center rounded-full bg-slate-800/95 text-white shadow hover:bg-rose-500"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              id="landing-prompt"
              rows={3}
              maxLength={4000}
              value={landingPrompt}
              onChange={(event) => {
                const prompt = event.target.value;
                setLandingPrompt(prompt);
                persistOnboardingDraft(prompt, attachments);
              }}
              placeholder="Design a wireframe for..."
              className="w-full resize-y bg-transparent px-2 py-2 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 sm:text-base"
            />
            {landingAttachmentError && (
              <div role="alert" className="flex flex-wrap items-center gap-2 px-2 pb-2 text-xs leading-5 text-rose-300">
                <span>{landingAttachmentError}</span>
                {cameraUploadFallback && (
                  <button
                    type="button"
                    onClick={() => landingImageInputRef.current?.click()}
                    className="min-h-11 rounded-lg border border-rose-300/20 px-3 font-medium text-rose-200 hover:bg-rose-300/[0.08]"
                  >
                    Upload image / បញ្ចូលរូបភាព
                  </button>
                )}
              </div>
            )}
            {processingImages && (
              <p role="status" className="px-2 pb-2 text-xs text-slate-400">Preparing images securely…</p>
            )}
            {cameraStarting && (
              <div role="status" className="flex items-center justify-between gap-2 px-2 pb-2 text-xs text-slate-400">
                <span>Waiting for camera access…</span>
                <button
                  type="button"
                  onClick={closeCamera}
                  className="min-h-11 rounded-lg border border-white/10 px-3 text-slate-300 hover:bg-white/[0.06]"
                >
                  Cancel / បោះបង់
                </button>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3">
              <div className="flex min-w-0 items-center gap-2">
                <div ref={attachmentMenuRef} className="relative shrink-0">
                  <button
                    ref={attachmentButtonRef}
                    type="button"
                    onClick={() => setAttachmentMenuOpen((open) => !open)}
                    disabled={processingImages || cameraStarting || attachments.length >= MAX_PROMPT_IMAGES}
                    aria-label="Add context / បន្ថែមឯកសារយោង"
                    aria-haspopup="menu"
                    aria-expanded={attachmentMenuOpen}
                    title="Add context / បន្ថែមឯកសារយោង"
                    className="grid size-11 place-items-center rounded-xl text-slate-300 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus size={19} />
                  </button>
                  {attachmentMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Add context / បន្ថែមឯកសារយោង"
                      className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-60 rounded-xl border border-white/10 bg-[#171d24] p-1.5 shadow-2xl shadow-black/40"
                    >
                      <button
                        ref={firstAttachmentMenuItemRef}
                        type="button"
                        role="menuitem"
                        onClick={() => void openCamera()}
                        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-slate-200 hover:bg-white/[0.07]"
                      >
                        <Camera size={17} className="shrink-0 text-emerald-300" />
                        <span>Take photo <span className="text-xs text-slate-500">/ ថតរូប</span></span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAttachmentMenuOpen(false);
                          landingImageInputRef.current?.click();
                        }}
                        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-slate-200 hover:bg-white/[0.07]"
                      >
                        <ImagePlus size={17} className="shrink-0 text-slate-400" />
                        <span>Upload image <span className="text-xs text-slate-500">/ បញ្ចូលរូបភាព</span></span>
                      </button>
                    </div>
                  )}
                </div>
                <span className="truncate text-[11px] text-slate-500">
                  Prompt and images are kept until you sign in.
                </span>
              </div>
              <button
                type="submit"
                disabled={(!landingPrompt.trim() && attachments.length === 0) || authState === "checking" || processingImages}
                aria-label="Start building / ចាប់ផ្តើមបង្កើត"
                className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp size={19} />
              </button>
            </div>
          </form>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {[
              ["🌐 Website", "Design a responsive website for "],
              ["📱 Mobile UI", "Design a responsive mobile-style web interface for "],
              ["🎨 Design", "Create a polished UI design for "],
              ["📊 Slides", "Create a presentation-style landing page for "],
              ["✨ Animation", "Design a web page with subtle animations for "],
            ].map(([label, prompt]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setLandingPrompt(prompt);
                  document.getElementById("landing-prompt")?.focus();
                }}
                className="rounded-full border border-white/[0.09] bg-white/[0.025] px-3.5 py-2 text-xs text-slate-400 transition hover:border-emerald-300/30 hover:text-emerald-100"
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section id="features" className="border-y border-white/[0.07] bg-white/[0.015] px-5 py-14 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Built for ideas</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">From prompt to working preview</h2>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [Sparkles, "AI project agent", "Get a structured proposal before code is generated."],
                [Code2, "Editable source", "Inspect and edit generated React and TypeScript files."],
                [Monitor, "Live preview", "See responsive UI updates in an in-browser React sandbox."],
                [ShieldCheck, "Protected account", "Verified sign-in, server-side project limits, and payment checks."],
              ].map(([Icon, title, description]) => (
                <article key={String(title)} className="rounded-2xl border border-white/[0.08] bg-[#101419] p-5">
                  <span className="grid size-9 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300">
                    <Icon size={17} />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-slate-100">{String(title)}</h3>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{String(description)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="plans" className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Straightforward plans</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Try it before you upgrade</h2>
          </div>
          <div className="mx-auto mt-7 grid max-w-5xl gap-3 md:grid-cols-3">
            {[
              { name: "Starter", price: "$0", term: "/ month", description: "One generated project to try the builder.", detail: "Live preview included" },
              { name: "Pro monthly", price: "$14.99", term: "/ month", description: "Create projects and export project JSON.", detail: "ABA KHQR · manual renewal" },
              { name: "Pro annual", price: "$129.99", term: "/ year", description: "Pro access for a single prepaid year.", detail: "ABA KHQR · manual renewal" },
            ].map((plan) => (
              <article key={plan.name} className="rounded-2xl border border-white/[0.09] bg-[#101419] p-5">
                <h3 className="text-sm font-semibold">{plan.name}</h3>
                <p className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
                  <span className="text-xs text-slate-500">{plan.term}</span>
                </p>
                <p className="mt-3 min-h-10 text-xs leading-5 text-slate-400">{plan.description}</p>
                <p className="mt-3 border-t border-white/[0.07] pt-3 text-[11px] text-slate-500">{plan.detail}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (plan.price === "$0") setAuthMode("register");
                    else window.location.assign("/pricing");
                    accountSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  className="mt-5 min-h-10 w-full rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-300/30 hover:bg-emerald-400/[0.06]"
                >
                  {plan.price === "$0" ? "Start for free" : "View plan & pay"}
                </button>
              </article>
            ))}
          </div>
          <p className="mx-auto mt-4 max-w-3xl text-center text-[11px] leading-5 text-slate-500">
            Pro plans are prepaid and do not auto-renew. Website publishing and hosting are not currently provided.
          </p>
        </section>

        <section ref={accountSectionRef} id="account" className="border-t border-white/[0.07] bg-[#0e1217] px-5 py-14 sm:px-8">
          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[1fr_420px] md:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Get started</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Build your first project for free</h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">
                Create and verify an account, then use the Builder to generate one project with a live preview. No payment is needed to start.
              </p>
              <ul className="mt-5 space-y-2 text-xs text-slate-400">
                <li className="flex items-center gap-2"><Check size={14} className="text-emerald-300" /> One trial project per account</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-emerald-300" /> Upgrade only when you need more projects or export</li>
              </ul>
            </div>
            <form
              onSubmit={submitLogin}
              className="space-y-4 rounded-2xl border border-white/10 bg-[#11171d] p-5 shadow-xl sm:p-6"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
                  <ShieldCheck size={19} />
                </span>
                <div>
                  <h2 className="text-base font-semibold">{authMode === "login" ? "Sign in to Phollet AI" : "Create your free account"}</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-400">Email verification is required before Builder access.</p>
                </div>
              </div>
              <a
                href="/api/auth/google"
                className="flex min-h-10 w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              >
                <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px]">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 5)" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.9c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.36 38.04 46.98 31.95 46.98 24.55Z" transform="translate(0 -1)" />
                  <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.89.93 7.57 2.56 10.78l7.97-6.19Z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.89 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" transform="translate(0 -5)" />
                </svg>
                Continue with Google
              </a>
              {authState === "checking" ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <LoaderCircle size={15} className="animate-spin" />
                  Checking secure access…
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    <span className="h-px flex-1 bg-white/10" />
                    or continue with email
                    <span className="h-px flex-1 bg-white/10" />
                  </div>
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
                  {authError && <p role="alert" className="text-xs leading-5 text-rose-300">{authError}</p>}
                  <button
                    type="submit"
                    disabled={authBusy || !authPassword}
                    className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {authBusy && <LoaderCircle size={15} className="animate-spin" />}
                    {authMode === "login" ? "Sign in" : "Create free account"}
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
                    {authMode === "login" ? "New here? Create a free account" : "Already registered? Sign in"}
                  </button>
                </>
              )}
              <Link href="/pricing" className="block text-center text-xs font-medium text-emerald-300 hover:text-emerald-200">
                See all plans and ABA KHQR checkout
              </Link>
            </form>
          </div>
        </section>
        {cameraStream && (
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeCamera();
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="camera-title"
              className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#11171d] p-4 shadow-2xl sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="camera-title" className="text-base font-semibold">Take a photo / ថតរូប</h2>
                <button
                  type="button"
                  onClick={closeCamera}
                  aria-label="Close camera / បិទកាមេរ៉ា"
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-white/[0.07] hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="mt-4 overflow-hidden rounded-xl bg-black">
                {cameraCaptureUrl ? (
                  <img src={cameraCaptureUrl} alt="Captured photo preview" className="aspect-video w-full object-contain" />
                ) : (
                  <video ref={cameraVideoRef} autoPlay playsInline muted className="aspect-video w-full object-contain" />
                )}
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {cameraCapture ? (
                  <>
                    <button
                      type="button"
                      onClick={retakeCameraPhoto}
                      className="min-h-11 rounded-xl border border-white/10 px-4 text-sm font-medium text-slate-200 hover:bg-white/[0.06]"
                    >
                      Retake / ថតម្ដងទៀត
                    </button>
                    <button
                      type="button"
                      onClick={useCameraPhoto}
                      disabled={processingImages || attachments.length >= MAX_PROMPT_IMAGES}
                      className="min-h-11 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
                    >
                      Use photo / ប្រើរូបនេះ
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={captureCameraPhoto}
                    className="min-h-11 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-white hover:bg-emerald-400"
                  >
                    Capture / ថតរូប
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
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
          <span className="hidden rounded-full border border-emerald-300/15 bg-emerald-300/[0.05] px-2.5 py-1 text-[10px] font-medium text-emerald-200 sm:inline-flex">
            {isPro ? "Pro active" : `Free trial · ${trialProjectCount}/${FREE_TRIAL_PROJECT_LIMIT} projects`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {savedProjects.length > 0 && (
            <select
              aria-label="Open a saved project"
              value={currentProjectId ?? ""}
              onChange={(event) => {
                const projectId = event.currentTarget.value;
                if (projectId) void openSavedProject(projectId);
                else clearWorkspace();
              }}
              className="max-w-32 rounded-lg border border-white/10 bg-[#151a20] px-2 py-2 text-[11px] text-slate-300 outline-none focus:border-emerald-400/50 sm:max-w-44 sm:text-xs"
            >
              <option value="">New project</option>
              {savedProjects.map((project, index) => (
                <option key={project.id} value={project.id}>
                  Project {index + 1} · {project.updatedAt.slice(0, 10)}
                </option>
              ))}
            </select>
          )}
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
                    disabled={busy || processingImages || attachments.length >= MAX_PROMPT_IMAGES}
                    aria-label="Attach an image"
                    title="Attach an image"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
                  >
                    <ImagePlus size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={busy || processingImages || attachments.length >= MAX_PROMPT_IMAGES}
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

        <section className={`${panelVisibility("code", mobilePanel)} notranslate`} translate="no">
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

        <section className={`${panelVisibility("preview", mobilePanel)} notranslate`} translate="no">
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
              <div className="sandpack h-full notranslate" translate="no">
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
              onClick={() => void exportProject()}
            >
              <ArrowDownToLine size={12} />
              Export project JSON{!isPro && " · Pro"}
            </button>
          </div>
        </section>
      </div>
      {paywallOpen && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-black/75 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPaywallOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="trial-paywall-title"
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#11171d] p-6 text-center shadow-2xl"
          >
            <div className="mx-auto grid size-11 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
              <Sparkles size={21} />
            </div>
            <h2 id="trial-paywall-title" className="mt-4 text-lg font-semibold">
              {isPro ? "Pro access is required" : "Your free project is ready"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              The free trial includes one project and its live preview. Upgrade to Pro to create more projects and export project JSON. Pro payments use ABA KHQR and do not auto-renew.
            </p>
            <Link
              href="/pricing"
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400"
            >
              View Pro plans
            </Link>
            <button
              type="button"
              onClick={() => setPaywallOpen(false)}
              className="mt-2 w-full rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.06]"
            >
              Continue with my trial project
            </button>
          </section>
        </div>
      )}
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
                <p className="mt-1 text-xs leading-5 text-slate-500">Manage your Builder session and understand how your data is handled.</p>
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
                  <li>Generated project files are saved to your account so you can restore your latest project. Chat history and image attachments remain in this browser session.</li>
                  <li>Prompts and attached images are sent to the configured AI provider to answer your request. The provider’s own data policies apply.</li>
                  <li>Images are resized and re-encoded before upload to reduce size and remove embedded metadata. Only JPEG, PNG, and WebP inputs are accepted.</li>
                  <li>Voice transcription uses your browser’s speech service; audio is not sent to this Builder API, but browser-provider handling may vary.</li>
                </ul>
              </section>

              <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                <h3 className="text-xs font-semibold text-slate-200">Credentials &amp; access</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  AI keys stay on the server in environment variables and are never requested by this page. Account access uses a verified email/password or Google sign-in with a secure session cookie. Do not include credentials in prompts or generated code.
                </p>
              </section>

              <div className="flex flex-col-reverse gap-2 border-t border-white/[0.08] pt-4 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={clearWorkspace}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 hover:border-emerald-400/30 hover:text-emerald-200"
                >
                  <Plus size={14} />
                  Start a new project
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
