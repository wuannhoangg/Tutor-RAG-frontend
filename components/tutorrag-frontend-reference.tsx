"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/utils/supabase/client";
import { motion } from "framer-motion";
import {
  Upload,
  KeyRound,
  Cloud,
  FolderOpen,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  UserCircle2,
  LogOut,
  FolderPlus,
  SendHorizonal,
  FileText,
  Layers3,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api/v1";

type UploadedFile = {
  name: string;
  pages: number | string;
  status: string;
  documentId?: string;
  chunkCount?: number;
  folderId?: string;
};

type CitationItem = {
  source?: string;
  source_name?: string;
  file_name?: string;
  filename?: string;
  title?: string;
  document_name?: string;
  document_id?: string;
  chunk_id?: string;
  page?: number;
  page_start?: number;
  page_end?: number;
  snippet?: string;
  metadata?: Record<string, any>;
};

type BackendEnvelope<T = any> = {
  success?: boolean;
  message?: string;
  data?: T;
  detail?: string;
};

type ProviderOption = {
  label: string;
  value: string;
  defaultModel: string;
  defaultBaseUrl: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: CitationItem[];
  loading?: boolean;
};

type FolderItem = {
  id: string;
  name: string;
  system?: boolean;
};

type SSEParsedEvent = {
  event: string;
  data: any | null;
};

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    label: "Google AI",
    value: "google_ai",
    defaultModel: "gemini-2.0-flash",
    defaultBaseUrl: "",
  },
  {
    label: "OpenAI",
    value: "openai",
    defaultModel: "gpt-4o-mini",
    defaultBaseUrl: "",
  },
  {
    label: "Anthropic",
    value: "anthropic",
    defaultModel: "claude-3-5-haiku-latest",
    defaultBaseUrl: "",
  },
];

const BYOK_PROVIDER_VALUES = ["google_ai", "openai", "anthropic"];

const initialFolders: FolderItem[] = [
  { id: "all", name: "All documents", system: true },
];

const initialFiles: UploadedFile[] = [];

function getProviderMeta(value: string): ProviderOption {
  return (
    PROVIDER_OPTIONS.find((item) => item.value === value) || PROVIDER_OPTIONS[0]
  );
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function pickAnswer(payload: any): string {
  if (!payload) return "";

  if (typeof payload.answer_text === "string") return payload.answer_text;
  if (typeof payload.answer === "string") return payload.answer;

  if (payload.answer && typeof payload.answer === "object") {
    if (typeof payload.answer.answer_text === "string") {
      return payload.answer.answer_text;
    }
    if (typeof payload.answer.answer === "string") {
      return payload.answer.answer;
    }
  }

  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.response === "string") return payload.response;
  if (typeof payload.final_answer === "string") return payload.final_answer;

  return "";
}

function normalizeCitation(item: any): CitationItem {
  return {
    source: item?.source,
    source_name: item?.source_name,
    file_name: item?.file_name,
    filename: item?.filename,
    title: item?.title,
    document_name: item?.document_name || item?.documentName,
    document_id: item?.document_id || item?.documentId,
    chunk_id: item?.chunk_id || item?.chunkId,
    page: item?.page,
    page_start: item?.page_start ?? item?.pageStart,
    page_end: item?.page_end ?? item?.pageEnd,
    snippet: item?.snippet || item?.text || item?.metadata?.snippet,
    metadata: item?.metadata,
  };
}

function pickCitations(payload: any): CitationItem[] {
  if (!payload) return [];

  const nestedAnswerCitations = Array.isArray(payload?.answer?.citations)
    ? payload.answer.citations.map(normalizeCitation)
    : [];

  const directCitations = Array.isArray(payload?.citations)
    ? payload.citations.map(normalizeCitation)
    : [];

  const evidenceItems = Array.isArray(payload?.evidence)
    ? payload.evidence.map(normalizeCitation)
    : [];

  if (nestedAnswerCitations.length > 0) return nestedAnswerCitations;
  if (directCitations.length > 0) return directCitations;
  return evidenceItems;
}

function getErrorMessage(result: any, fallback: string): string {
  if (!result) return fallback;
  if (typeof result.detail === "string") return result.detail;
  if (typeof result.message === "string") return result.message;
  return fallback;
}

function formatPageLabel(item: CitationItem) {
  const exactPage = item.page;
  const start = item.page_start;
  const end = item.page_end;

  if (typeof exactPage === "number") return `Trang ${exactPage}`;
  if (typeof start === "number" && typeof end === "number") {
    return start === end ? `Trang ${start}` : `Trang ${start}-${end}`;
  }
  if (typeof start === "number") return `Trang ${start}`;
  return "Trang chưa rõ";
}

function looksLikeOpaqueId(value?: string) {
  if (!value) return false;
  const normalized = value.trim();
  if (!normalized) return false;

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f-]{16,}$/i.test(normalized);
  const hashLike = /^[0-9a-f]{20,}$/i.test(normalized);
  const objectIdLike = /^[A-Za-z0-9_-]{24,}$/i.test(normalized);

  return uuidLike || hashLike || objectIdLike;
}

function resolveCitationSourceName(
  item: CitationItem,
  documentNameById: Record<string, string>
) {
  const metadata = item.metadata || {};
  const candidates = [
    item.source_name,
    item.file_name,
    item.filename,
    item.document_name,
    item.title,
    metadata.original_filename,
    metadata.file_name,
    metadata.filename,
    metadata.document_name,
    metadata.source_name,
    metadata.source_file,
    metadata.title,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (!looksLikeOpaqueId(candidate)) return candidate;
  }

  if (item.document_id && documentNameById[item.document_id]) {
    return documentNameById[item.document_id];
  }

  if (item.source && documentNameById[item.source]) {
    return documentNameById[item.source];
  }

  if (item.source && !looksLikeOpaqueId(item.source)) {
    return item.source;
  }

  return "Untitled source";
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function parseSSEEvent(rawEvent: string): SSEParsedEvent {
  const lines = rawEvent.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  const rawData = dataLines.join("\n");
  if (!rawData) {
    return { event: eventName, data: null };
  }

  try {
    return {
      event: eventName,
      data: JSON.parse(rawData),
    };
  } catch {
    return {
      event: eventName,
      data: rawData,
    };
  }
}

function getStageLabel(stage?: string) {
  switch (stage) {
    case "classifying":
      return "classifying...";
    case "planning":
      return "planning...";
    case "routing":
      return "routing...";
    case "retrieving":
      return "retrieving...";
    case "generating":
      return "generating...";
    case "verifying":
      return "verifying...";
    default:
      return "TutorRAG đang xử lý...";
  }
}

function cleanStreamedChunkCitations(text: string): string {
  if (!text) return text;

  const seen: string[] = [];

  const withNumericRefs = text.replace(
    /\[([A-Za-z0-9]+_chunk_\d+)\]/g,
    (_match, chunkId: string) => {
      if (!seen.includes(chunkId)) {
        seen.push(chunkId);
      }
      return `[${seen.indexOf(chunkId) + 1}]`;
    }
  );

  return withNumericRefs
    .replace(/\b([A-Za-z0-9]+_chunk_\d+)\b/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

export default function TutorRAGFrontendRedesigned() {
  const [providerMode, setProviderMode] = useState<"platform" | "byok">("platform");
  const [provider, setProvider] = useState<string>("google_ai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("gemini-2.0-flash");

  const [question, setQuestion] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [loadingAuth, setLoadingAuth] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-message",
      role: "assistant",
      content: "Chào bạn. Hãy tải tài liệu và bắt đầu đặt câu hỏi.",
      citations: [],
    },
  ]);
  const [sourceCitations, setSourceCitations] = useState<CitationItem[]>([]);
  const [isAsking, setIsAsking] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(initialFiles);
  const [folders, setFolders] = useState<FolderItem[]>(initialFolders);
  const [activeFolderId, setActiveFolderId] = useState("all");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (providerMode === "byok" && !BYOK_PROVIDER_VALUES.includes(provider)) {
      setProvider("google_ai");
    }
  }, [providerMode, provider]);

  useEffect(() => {
    const meta = getProviderMeta(provider);
    setModelName(meta.defaultModel);
    setBaseUrl(meta.defaultBaseUrl);

    if (providerMode !== "byok") {
      setApiKey("");
    }
  }, [providerMode, provider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      activeAbortRef.current?.abort();
      activeReaderRef.current?.cancel().catch(() => undefined);
    };
  }, []);

  const providerLabel = useMemo(() => {
    if (providerMode === "platform") return "Shared model";
    return "Bring your own key";
  }, [providerMode]);

  const currentProviderMeta = getProviderMeta(provider);

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const folder of folders) {
      if (folder.id === "all") {
        counts[folder.id] = uploadedFiles.length;
      } else {
        counts[folder.id] = uploadedFiles.filter(
          (file) => file.folderId === folder.id
        ).length;
      }
    }

    return counts;
  }, [folders, uploadedFiles]);

  const visibleFiles = useMemo(() => {
    if (activeFolderId === "all") return uploadedFiles;
    return uploadedFiles.filter((file) => file.folderId === activeFolderId);
  }, [activeFolderId, uploadedFiles]);

  const documentNameById = useMemo(() => {
    const mapping: Record<string, string> = {};
    for (const file of uploadedFiles) {
      if (file.documentId) {
        mapping[file.documentId] = file.name;
      }
    }
    return mapping;
  }, [uploadedFiles]);

  const emailConfirmed = !!user?.email_confirmed_at;

  const fetchWorkspace = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      throw new Error("Không tìm thấy access token.");
    }

    const [foldersRes, documentsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/documents/folders`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${API_BASE_URL}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const foldersJson: BackendEnvelope<any[]> = await foldersRes.json().catch(() => ({}));
    const documentsJson: BackendEnvelope<any[]> = await documentsRes.json().catch(() => ({}));

    if (!foldersRes.ok) {
      throw new Error(getErrorMessage(foldersJson, "Không tải được folders."));
    }
    if (!documentsRes.ok) {
      throw new Error(getErrorMessage(documentsJson, "Không tải được documents."));
    }

    const backendFolders = Array.isArray(foldersJson.data) ? foldersJson.data : [];
    const backendDocuments = Array.isArray(documentsJson.data) ? documentsJson.data : [];

    const normalizedFolders: FolderItem[] = [
      { id: "all", name: "All documents", system: true },
      ...backendFolders.map((folder: any) => ({
        id: folder.folder_id,
        name: folder.name,
        system: !!folder.system,
      })),
    ];

    const normalizedFiles: UploadedFile[] = backendDocuments.map((doc: any) => ({
      name: doc.name || "Untitled",
      pages: doc.chunk_count ?? "-",
      status: doc.status || "Indexed",
      documentId: doc.document_id,
      folderId: doc.folder_id || "uploads",
    }));

    setFolders(normalizedFolders);
    setUploadedFiles(normalizedFiles);
  };

  useEffect(() => {
    if (!authReady) return;
    if (!user) return;
    if (!emailConfirmed) return;

    fetchWorkspace().catch((error) => {
      console.error("Failed to fetch workspace", error);
      setAuthNotice(error.message || "Không tải được workspace.");
    });
  }, [authReady, user, emailConfirmed]);

  const handleSignUp = async () => {
    setLoadingAuth(true);
    setAuthNotice("");

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      alert(error.message);
      setLoadingAuth(false);
      return;
    }

    if (data.user && !data.session) {
      setAuthNotice("Đăng ký thành công. Hãy kiểm tra email để xác thực tài khoản trước khi đăng nhập.");
      alert("Đăng ký thành công. Hãy kiểm tra email để xác thực tài khoản.");
      setLoadingAuth(false);
      return;
    }

    if (data.session && !data.user?.email_confirmed_at) {
      setAuthNotice("Tài khoản đã được tạo nhưng chưa xác thực email. Hãy kiểm tra email trước khi dùng hệ thống.");
      alert("Tài khoản đã được tạo. Hãy xác thực email trước khi đăng nhập.");
      await supabase.auth.signOut();
      setLoadingAuth(false);
      return;
    }

    setAuthNotice("Đăng ký thành công. Bạn có thể đăng nhập.");
    alert("Đăng ký thành công!");
    setLoadingAuth(false);
  };

  const handleSignIn = async () => {
    setLoadingAuth(true);
    setAuthNotice("");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      alert(error.message);
      setLoadingAuth(false);
      return;
    }

    if (!data.session) {
      alert("Đăng nhập thất bại: không nhận được session.");
      setLoadingAuth(false);
      return;
    }

    if (!data.user?.email_confirmed_at) {
      setAuthNotice("Email của bạn chưa được xác thực. Hãy xác thực email trước khi đăng nhập.");
      alert("Email chưa được xác thực.");
      await supabase.auth.signOut();
      setLoadingAuth(false);
      return;
    }

    setLoadingAuth(false);
  };

  const handleSignOut = async () => {
    activeAbortRef.current?.abort();
    activeReaderRef.current?.cancel().catch(() => undefined);
    setAuthNotice("");
    await supabase.auth.signOut();
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || !user) return;

    const exists = folders.some(
      (folder) => folder.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      alert("Tên folder đã tồn tại.");
      return;
    }

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        throw new Error("Không tìm thấy access token.");
      }

      const response = await fetch(`${API_BASE_URL}/documents/folders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: trimmed }),
      });

      const result: BackendEnvelope<any> = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(getErrorMessage(result, `Lỗi từ Backend: ${response.status}`));
      }

      const folder = result.data;
      const newFolder: FolderItem = {
        id: folder.folder_id,
        name: folder.name,
        system: !!folder.system,
      };

      setFolders((prev) => [...prev, newFolder]);
      setActiveFolderId(newFolder.id);
      setNewFolderName("");
      setIsCreatingFolder(false);
    } catch (error: any) {
      console.error(error);
      alert("Không tạo được folder: " + error.message);
    }
  };

  const buildLLMConfig = () => {
    if (providerMode === "platform") {
      return { mode: "platform_default" };
    }

    const trimmedModel = modelName.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedApiKey = apiKey.trim();

    return {
      mode: "byok",
      provider,
      api_key: trimmedApiKey || undefined,
      base_url: trimmedBaseUrl || undefined,
      model: trimmedModel || undefined,
    };
  };

  const buildChatHistory = (): Array<{ role: "user" | "assistant"; content: string }> => {
    return messages
      .filter((message) => !message.loading)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
  };

  const handleAsk = async () => {
    if (!question.trim()) return;

    if (!user) {
      alert("Vui lòng đăng nhập trước khi hỏi AI nhé!");
      return;
    }

    if (!emailConfirmed) {
      alert("Bạn cần xác thực email trước khi sử dụng hệ thống.");
      return;
    }

    activeAbortRef.current?.abort();
    activeReaderRef.current?.cancel().catch(() => undefined);

    const abortController = new AbortController();
    activeAbortRef.current = abortController;

    const userMessage = question.trim();
    const assistantMessageId = makeId("assistant");

    setIsAsking(true);
    setQuestion("");
    setSourceCitations([]);

    const historyBeforeNewQuestion = buildChatHistory();

    setMessages((prev) => [
      ...prev,
      {
        id: makeId("user"),
        role: "user",
        content: userMessage,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "TutorRAG đang xử lý...",
        loading: true,
        citations: [],
      },
    ]);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        throw new Error("Không tìm thấy access token. Vui lòng đăng nhập lại.");
      }

      const response = await fetch(`${API_BASE_URL}/chat/ask/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          question: userMessage,
          query_text: userMessage,
          chat_history: historyBeforeNewQuestion,
          llm_config: buildLLMConfig(),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const result: BackendEnvelope = await response.json().catch(() => ({}));
          throw new Error(
            getErrorMessage(result, `Lỗi từ Backend: ${response.status}`)
          );
        }

        const rawText = await response.text().catch(() => "");
        throw new Error(rawText || `Lỗi từ Backend: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("Backend không trả về stream.");
      }

      const reader = response.body.getReader();
      activeReaderRef.current = reader;

      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let streamedRawText = "";
      let finalPayload: any = null;

      const updateAssistant = (
        updater: (current: ChatMessage) => ChatMessage
      ) => {
        setMessages((prev) =>
          prev.map((item) =>
            item.id === assistantMessageId ? updater(item) : item
          )
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const rawEvent of parts) {
          const parsed = parseSSEEvent(rawEvent);
          const eventName = parsed.event;
          const payload = parsed.data;

          if (eventName === "ping" || eventName === "meta" || eventName === "retrieval") {
            continue;
          }

          if (eventName === "status") {
            updateAssistant((current) => ({
              ...current,
              content: cleanStreamedChunkCitations(streamedRawText) || getStageLabel(payload?.stage),
              loading: true,
            }));
            continue;
          }

          if (eventName === "token") {
            const nextText =
              typeof payload?.text === "string" ? payload.text : "";

            if (!nextText) continue;

            streamedRawText += nextText;
            const cleanedStreamedText = cleanStreamedChunkCitations(streamedRawText);

            updateAssistant((current) => ({
              ...current,
              content: cleanedStreamedText,
              loading: true,
            }));
            continue;
          }

          if (eventName === "final") {
            finalPayload = payload;

            const extractedAnswer =
              cleanStreamedChunkCitations(pickAnswer(payload)) ||
              cleanStreamedChunkCitations(streamedRawText) ||
              "Đã nhận được phản hồi nhưng không có text.";

            const citations = pickCitations(payload);
            setSourceCitations(citations);

            updateAssistant((current) => ({
              ...current,
              content: extractedAnswer,
              citations,
              loading: false,
            }));
            continue;
          }

          if (eventName === "error") {
            throw new Error(
              payload?.message || "Lỗi stream từ Backend."
            );
          }
        }
      }

      if (buffer.trim()) {
        const parsed = parseSSEEvent(buffer.trim());
        if (parsed.event === "final") {
          finalPayload = parsed.data;

          const extractedAnswer =
            cleanStreamedChunkCitations(pickAnswer(parsed.data)) ||
            cleanStreamedChunkCitations(streamedRawText) ||
            "Đã nhận được phản hồi nhưng không có text.";

          const citations = pickCitations(parsed.data);
          setSourceCitations(citations);

          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantMessageId
                ? {
                    ...item,
                    content: extractedAnswer,
                    citations,
                    loading: false,
                  }
                : item
            )
          );
        }
      }

      if (!finalPayload) {
        const fallbackAnswer =
          cleanStreamedChunkCitations(streamedRawText) || "Đã kết thúc stream nhưng không có payload cuối.";

        setSourceCitations([]);

        setMessages((prev) =>
          prev.map((item) =>
            item.id === assistantMessageId
              ? {
                  ...item,
                  content: fallbackAnswer,
                  citations: [],
                  loading: false,
                }
              : item
          )
        );
      }
    } catch (error: any) {
      console.error(error);

      const message =
        error?.name === "AbortError"
          ? "Yêu cầu đã bị hủy."
          : "Oops! Lỗi kết nối đến Backend: " + error.message;

      setSourceCitations([]);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantMessageId
            ? {
                ...item,
                content: message,
                citations: [],
                loading: false,
              }
            : item
        )
      );
    } finally {
      activeReaderRef.current = null;
      activeAbortRef.current = null;
      setIsAsking(false);
    }
  };

  const handleQuestionKeyDown = async (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isAsking) {
        await handleAsk();
      }
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!user) {
      alert("Vui lòng đăng nhập trước khi tải tài liệu lên nhé!");
      return;
    }

    if (!emailConfirmed) {
      alert("Bạn cần xác thực email trước khi tải tài liệu.");
      return;
    }

    setIsUploading(true);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        throw new Error("Không tìm thấy access token. Vui lòng đăng nhập lại.");
      }

      const targetFolderId =
        activeFolderId === "all"
          ? folders.find((folder) => folder.name === "Uploads")?.id || "uploads"
          : activeFolderId;

      const formData = new FormData();
      formData.append("file", file);
      formData.append("language", "vi");
      formData.append("folder_id", targetFolderId);

      const response = await fetch(`${API_BASE_URL}/upload/file`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const result: BackendEnvelope<{
        document_id?: string;
        chunk_count?: number;
        metadata?: {
          original_filename?: string;
          subject?: string | null;
          language?: string;
        };
      }> = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(getErrorMessage(result, `Lỗi từ Backend: ${response.status}`));
      }

      const payload = result.data ?? {};

      alert("Tải lên và xử lý tài liệu thành công!");

      const newFile: UploadedFile = {
        name: payload?.metadata?.original_filename || file.name,
        pages: payload?.chunk_count ?? "-",
        status: "Indexed",
        documentId: payload?.document_id,
        chunkCount: payload?.chunk_count,
        folderId: targetFolderId,
      };

      setUploadedFiles((prev) => [newFile, ...prev]);
    } catch (error: any) {
      console.error(error);
      alert("Oops! Lỗi khi tải file: " + error.message);
    } finally {
      setIsUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const renderTabsTriggerClassName =
    "rounded-full px-4 text-sm text-white/72 transition data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-sm hover:text-white";

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        Đang khởi tạo phiên...
      </div>
    );
  }

  if (!user || !emailConfirmed) {
    return (
      <div className="min-h-screen overflow-hidden bg-[#050505] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.05),transparent_24%)]" />

        <div className="relative flex min-h-screen items-center justify-center px-6 py-10">
          <div className="grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="text-center lg:text-left"
            >
              <div className="mb-5 text-xs font-semibold uppercase tracking-[0.45em] text-white/55">
                wuann
              </div>
              <h1 className="text-5xl font-semibold tracking-tight md:text-7xl">
                TutorRAG
              </h1>
              <div className="mt-4 text-base text-white/45">Grounded study assistant</div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.08 }}
            >
              <Card className="rounded-[30px] border-white/10 bg-white/[0.04] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="text-2xl text-white">Đăng nhập</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="signin" className="space-y-5">
                    <TabsList className="grid h-11 grid-cols-2 rounded-full bg-white/[0.05] p-1">
                      <TabsTrigger value="signin" className={renderTabsTriggerClassName}>
                        Đăng nhập
                      </TabsTrigger>
                      <TabsTrigger value="signup" className={renderTabsTriggerClassName}>
                        Đăng ký
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="signin" className="space-y-4">
                      <Input
                        placeholder="Email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-12 rounded-2xl border-white/10 bg-black/40 text-white"
                      />
                      <Input
                        placeholder="Mật khẩu"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-12 rounded-2xl border-white/10 bg-black/40 text-white"
                      />
                      <Button
                        onClick={handleSignIn}
                        disabled={loadingAuth}
                        className="h-12 w-full rounded-2xl bg-white text-black hover:bg-white/90"
                      >
                        {loadingAuth ? "Đang xử lý..." : "Vào TutorRAG"}
                      </Button>
                    </TabsContent>

                    <TabsContent value="signup" className="space-y-4">
                      <Input
                        placeholder="Email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-12 rounded-2xl border-white/10 bg-black/40 text-white"
                      />
                      <Input
                        placeholder="Mật khẩu"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-12 rounded-2xl border-white/10 bg-black/40 text-white"
                      />
                      <Button
                        onClick={handleSignUp}
                        disabled={loadingAuth}
                        className="h-12 w-full rounded-2xl bg-white text-black hover:bg-white/90"
                      >
                        {loadingAuth ? "Đang xử lý..." : "Tạo tài khoản"}
                      </Button>
                    </TabsContent>
                  </Tabs>

                  {authNotice ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white/75">
                      {authNotice}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.04),transparent_22%)]" />

      <header className="relative border-b border-white/8 bg-black/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="text-xs font-semibold uppercase tracking-[0.45em] text-white/60">
              wuann
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-white/35">
                Grounded study assistant
              </div>
              <div className="text-[2rem] font-semibold tracking-tight">TutorRAG</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-white/85 hover:bg-white/[0.05]">
              {currentProviderMeta.label}
            </Badge>
            <div className="hidden rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/75 md:block">
              {user.email}
            </div>
            <Button
              onClick={handleSignOut}
              variant="ghost"
              className="rounded-full text-red-300 hover:bg-red-500/10 hover:text-red-200"
            >
              <LogOut className="mr-2 h-4 w-4" /> Đăng xuất
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-[1600px] px-6 py-6">
        <div className="grid gap-6 xl:grid-cols-12">
          <aside className="xl:col-span-3">
            <Card className="h-[calc(100vh-138px)] rounded-[30px] border-white/8 bg-white/[0.035] shadow-[0_14px_40px_rgba(0,0,0,0.28)]">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-[1.35rem] text-white">
                  <FolderOpen className="h-5 w-5" /> Tài liệu
                </CardTitle>
              </CardHeader>

              <CardContent className="flex h-[calc(100%-84px)] flex-col gap-5">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="file"
                    accept=".pdf,.docx,.pptx"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="h-11 rounded-full bg-white text-black hover:bg-white/90"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {isUploading ? "Uploading..." : "Up file"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setIsCreatingFolder((prev) => !prev)}
                    className="h-11 rounded-full border-white/10 bg-transparent text-white hover:bg-white/10"
                  >
                    <FolderPlus className="mr-2 h-4 w-4" /> Tạo folder
                  </Button>
                </div>

                {isCreatingFolder ? (
                  <div className="space-y-3 rounded-3xl border border-white/10 bg-black/30 p-3">
                    <Input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="Tên folder"
                      className="h-11 rounded-2xl border-white/10 bg-black/40 text-white"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleCreateFolder();
                        }
                      }}
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={handleCreateFolder}
                        className="flex-1 rounded-2xl bg-white text-black hover:bg-white/90"
                      >
                        Tạo
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsCreatingFolder(false);
                          setNewFolderName("");
                        }}
                        className="flex-1 rounded-2xl border-white/10 bg-transparent text-white hover:bg-white/10"
                      >
                        Hủy
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="grid min-h-0 flex-1 gap-4 lg:grid-rows-[auto_1fr]">
                  <div className="rounded-[28px] border border-white/10 bg-black/26 p-3">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white/70">
                      <Layers3 className="h-4 w-4" /> Folders
                    </div>
                    <div className="space-y-2">
                      {folders.map((folder) => {
                        const isActive = folder.id === activeFolderId;
                        return (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() => setActiveFolderId(folder.id)}
                            className={cn(
                              "flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition",
                              isActive
                                ? "border-white/14 bg-white/[0.08]"
                                : "border-white/8 bg-white/[0.02] hover:bg-white/[0.05]"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <FolderOpen className="h-4 w-4 text-white/70" />
                              <div className="text-sm font-medium text-white">{folder.name}</div>
                            </div>
                            <Badge className="rounded-full border border-white/10 bg-white/[0.07] text-white/75 hover:bg-white/[0.07]">
                              {folderCounts[folder.id] ?? 0}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="min-h-0 rounded-[28px] border border-white/10 bg-black/26 p-3">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white/70">
                      <FileText className="h-4 w-4" /> Files
                    </div>
                    <div className="max-h-[100%] space-y-3 overflow-y-auto pr-1">
                      {visibleFiles.length > 0 ? (
                        visibleFiles.map((file, index) => (
                          <div
                            key={`${file.name}-${index}`}
                            className="rounded-[24px] border border-white/10 bg-white/[0.03] p-3.5"
                          >
                            <div className="line-clamp-2 text-sm font-medium text-white">
                              {file.name}
                            </div>
                            <div className="mt-1 text-xs text-white/45">
                              {typeof file.pages === "number"
                                ? `${file.pages} chunks/pages`
                                : file.pages}
                            </div>
                            <div className="mt-3 flex items-center justify-between">
                              <Badge className="rounded-full border border-white/10 bg-white/[0.06] text-white/76 hover:bg-white/[0.06]">
                                {file.status}
                              </Badge>
                              <div className="text-[11px] text-white/32">
                                {folders.find((folder) => folder.id === file.folderId)?.name ||
                                  "Unknown folder"}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-white/40">
                          Folder trống
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </aside>

          <section className="xl:col-span-6">
            <Card className="flex h-[calc(100vh-138px)] flex-col rounded-[30px] border-white/8 bg-white/[0.035] shadow-[0_14px_40px_rgba(0,0,0,0.28)]">
              <CardHeader className="border-b border-white/8 pb-4">
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2 text-[1.35rem] text-white">
                    <MessageSquare className="h-5 w-5" /> Khung chat
                  </CardTitle>
                  <Badge className="rounded-full border border-white/10 bg-white/[0.05] text-white/70 hover:bg-white/[0.05]">
                    Enter để gửi
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-5">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${
                        message.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={cn(
                          "max-w-[88%] rounded-[26px] border px-4 py-3.5",
                          message.role === "user"
                            ? "border-white/15 bg-white text-black"
                            : "border-white/10 bg-black/40 text-white"
                        )}
                      >
                        <div className="mb-2 text-[11px] uppercase tracking-[0.24em] opacity-55">
                          {message.role === "user" ? "You" : "TutorRAG"}
                        </div>
                        <div className="whitespace-pre-wrap text-sm leading-7 md:text-[15px]">
                          {message.content}
                        </div>

                        {message.citations && message.citations.length > 0 ? (
                          <div className="mt-4 space-y-2">
                            {message.citations.slice(0, 2).map((item, index) => {
                              const sourceName = resolveCitationSourceName(
                                item,
                                documentNameById
                              );
                              return (
                                <div
                                  key={`${item.document_id || item.source || "citation"}-${index}`}
                                  className={cn(
                                    "rounded-2xl border px-3 py-2 text-xs leading-5",
                                    message.role === "user"
                                      ? "border-black/10 bg-black/5 text-black/70"
                                      : "border-white/10 bg-white/[0.03] text-white/66"
                                  )}
                                >
                                  <div className="font-medium">{sourceName}</div>
                                  <div>{formatPageLabel(item)}</div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                <div className="rounded-[28px] border border-white/10 bg-black/40 p-3">
                  <Textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={handleQuestionKeyDown}
                    placeholder="Nhắn TutorRAG ở đây..."
                    className="min-h-[112px] resize-none border-0 bg-transparent px-1 text-white shadow-none focus-visible:ring-0"
                  />

                  <div className="mt-3 flex items-center justify-end border-t border-white/8 pt-3">
                    <Button
                      onClick={handleAsk}
                      disabled={isAsking}
                      className="rounded-full bg-white px-5 text-black hover:bg-white/90"
                    >
                      <SendHorizonal className="mr-2 h-4 w-4" />
                      {isAsking ? "Đang xử lý..." : "Gửi"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <aside className="xl:col-span-3">
            <div className="grid h-[calc(100vh-138px)] gap-6 xl:grid-rows-[1.25fr_1fr]">
              <Card className="min-h-0 rounded-[30px] border-white/8 bg-white/[0.035] shadow-[0_14px_40px_rgba(0,0,0,0.28)]">
                <CardHeader className="pb-4">
                  <CardTitle className="text-[1.35rem] text-white">Nguồn trích dẫn</CardTitle>
                </CardHeader>
                <CardContent className="max-h-[calc(100%-72px)] space-y-3 overflow-y-auto pr-1">
                  {sourceCitations.length > 0 ? (
                    sourceCitations.map((item, index) => {
                      const sourceName = resolveCitationSourceName(item, documentNameById);
                      return (
                        <div
                          key={`${item.document_id || item.source || "evidence"}-${
                            item.chunk_id || index
                          }`}
                          className="rounded-[24px] border border-white/10 bg-black/38 p-4"
                        >
                          <div className="text-sm font-medium text-white">{sourceName}</div>
                          <div className="mt-1 text-xs text-white/50">{formatPageLabel(item)}</div>
                          {item.snippet ? (
                            <div className="mt-3 line-clamp-6 text-xs leading-6 text-white/62">
                              {item.snippet}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-white/40">
                      Chưa có dữ liệu
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="min-h-0 rounded-[30px] border-white/8 bg-white/[0.035] shadow-[0_14px_40px_rgba(0,0,0,0.28)]">
                <CardHeader className="pb-4">
                  <CardTitle className="text-[1.35rem] text-white">Runtime & account</CardTitle>
                </CardHeader>

                <CardContent className="space-y-5 overflow-y-auto">
                  <div className="flex items-center justify-between rounded-[24px] border border-emerald-500/25 bg-emerald-500/10 p-4">
                    <div className="flex items-center gap-3">
                      <UserCircle2 className="h-8 w-8 text-emerald-400" />
                      <div>
                        <div className="max-w-[180px] truncate text-sm font-medium text-white">
                          {user.email}
                        </div>
                        <div className="text-xs text-emerald-300">Đã kết nối</div>
                      </div>
                    </div>
                    <Badge className="rounded-full border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/10">
                      Online
                    </Badge>
                  </div>

                  <Tabs value={providerMode} onValueChange={(value) => setProviderMode(value as "platform" | "byok")}>
                    <TabsList className="grid h-11 grid-cols-2 rounded-full bg-white/[0.06] p-1">
                      <TabsTrigger value="platform" className={renderTabsTriggerClassName}>
                        Platform
                      </TabsTrigger>
                      <TabsTrigger value="byok" className={renderTabsTriggerClassName}>
                        BYOK
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="platform" className="mt-4">
                      <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-white/75">
                          <Sparkles className="h-4 w-4" /> Shared default model
                        </div>
                        <div className="mt-2 text-sm text-white/52">Platform runtime</div>
                      </div>
                    </TabsContent>

                    <TabsContent value="byok" className="mt-4 space-y-3">
                      <Select value={provider} onValueChange={setProvider}>
                        <SelectTrigger className="h-11 rounded-2xl border-white/10 bg-black/30 text-white">
                          <SelectValue placeholder="Choose provider" />
                        </SelectTrigger>
                        <SelectContent>
                          {PROVIDER_OPTIONS.filter((item) =>
                            BYOK_PROVIDER_VALUES.includes(item.value)
                          ).map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="h-11 rounded-2xl border-white/10 bg-black/30 text-white"
                        placeholder="API key"
                      />
                      <Input
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        className="h-11 rounded-2xl border-white/10 bg-black/30 text-white"
                        placeholder="Model"
                      />
                      <Input
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        className="h-11 rounded-2xl border-white/10 bg-black/30 text-white"
                        placeholder="Base URL"
                      />
                    </TabsContent>
                  </Tabs>

                  <div className="grid gap-3">
                    {[
                      { icon: KeyRound, label: providerLabel },
                      { icon: ShieldCheck, label: "Per-user workspace" },
                      { icon: Cloud, label: "Scale-to-zero deploy" },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="rounded-[22px] border border-white/10 bg-black/30 p-4"
                      >
                        <item.icon className="h-4 w-4 text-white/80" />
                        <div className="mt-2 text-sm text-white/72">{item.label}</div>
                      </div>
                    ))}
                  </div>

                  {authNotice ? (
                    <div className="rounded-[22px] border border-white/10 bg-black/30 p-4 text-sm text-white/72">
                      {authNotice}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}