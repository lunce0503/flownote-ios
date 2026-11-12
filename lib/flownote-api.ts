import { cloudApiUrl } from './cloud-url';

const apiBaseUrl = () => {
  const configuredUrl = process.env.EXPO_PUBLIC_WAS_URL;
  if (!configuredUrl) throw new Error('EXPO_PUBLIC_WAS_URL must be configured.');
  return cloudApiUrl(configuredUrl);
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
  baseUrl?: string;
};

const REQUEST_TIMEOUT_MS = 12_000;
const GET_RETRY_DELAYS_MS = [700, 1_400];
const RETRYABLE_GATEWAY_STATUSES = new Set([502, 503, 504]);

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const fetchWithTimeout = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchRequest = async (url: string, init: RequestInit, retryGet: boolean) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init);
      const retryDelay = GET_RETRY_DELAYS_MS[attempt];
      if (
        retryGet
        && retryDelay !== undefined
        && RETRYABLE_GATEWAY_STATUSES.has(response.status)
      ) {
        await delay(retryDelay);
        continue;
      }
      return response;
    } catch (error) {
      const retryDelay = GET_RETRY_DELAYS_MS[attempt];
      if (!retryGet || retryDelay === undefined) throw error;
      await delay(retryDelay);
    }
  }
};

export type FlownoteUser = {
  id: string;
  username: string;
  email: string;
  nickname: string;
};

export type LoginResponse = {
  token: string;
  user: FlownoteUser;
};

export type MobileConfig = {
  coreApiUrl: string;
  aiApiUrl: string;
  webUrl: string;
  minimumSupportedVersion: string;
  enabledFeatures: string[];
};

type MobileConfigResponse = MobileConfig & {
  core_api_url?: string;
  ai_api_url?: string;
  web_url?: string;
  minimum_supported_version?: string;
  enabled_features?: string[];
};

export type Task = {
  id: string;
  taskName: string;
  category: string | null;
  difficultyLevel: number | null;
  status: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  dueDate: string | null;
  memo: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type TaskResponse = Task & {
  task_name?: string;
  difficulty_level?: number | null;
  estimated_minutes?: number | null;
  actual_minutes?: number | null;
  due_date?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Note = {
  id: string;
  title: string;
  content: unknown;
  createdAt: string;
  updatedAt: string;
  revision: number;
  clientId?: string;
};

type NoteResponse = Note & {
  created_at?: string;
  updated_at?: string;
  client_id?: string;
};

export type CreateTaskInput = {
  taskName: string;
  category?: string;
  difficultyLevel?: number;
  status?: string;
  estimatedMinutes?: number;
  dueDate?: string;
  memo?: string;
  tags?: string[];
};

export type CreateNoteInput = {
  id?: string;
  title: string;
  content: unknown;
  createdAt?: string;
  revision?: number;
};

export type ChatMessage = {
  id: string;
  sender: 'user' | 'ai' | string;
  message: string;
  timestamp: string;
};

type ChatMessageResponse = ChatMessage & {
  created_at?: string;
};

export type CanvasTextBox = {
  id: string;
  x: number;
  y: number;
  text: string;
  width?: number;
  height?: number;
};

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasLine = {
  id: string;
  points: CanvasPoint[];
  color?: string;
  strokeWidth?: number;
};

export type CanvasImage = {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasData = {
  lines: CanvasLine[];
  images: CanvasImage[];
  textBoxes: CanvasTextBox[];
};

type CanvasResponse = CanvasData & {
  text_boxes?: CanvasTextBox[];
};

export type CanvasDocumentSummary = {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
};

export type CanvasFolder = {
  id: string;
  category: string;
  name: string;
  canvasIds: string[];
  created_at?: string;
  updated_at?: string;
};

type CanvasFolderResponse = Omit<CanvasFolder, 'canvasIds'> & {
  canvas_ids?: string[];
  canvasIds?: string[];
};

class FlownoteApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const method = options.method ?? 'GET';
  const response = await fetchRequest(`${cloudApiUrl(options.baseUrl ?? apiBaseUrl())}${path}`, {
    method,
    headers,
    body,
  }, method === 'GET');
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const data = text && contentType.includes('application/json') ? JSON.parse(text) : text || null;

  if (!response.ok) {
    const message =
      typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : `요청에 실패했습니다. (${response.status})`;
    throw new FlownoteApiError(response.status, message);
  }

  return data as T;
};

const makeUuid = () => {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) {
    return randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const normalizeTask = (task: TaskResponse): Task => ({
  id: task.id,
  taskName: task.taskName ?? task.task_name ?? '',
  category: task.category ?? null,
  difficultyLevel: task.difficultyLevel ?? task.difficulty_level ?? null,
  status: task.status ?? null,
  estimatedMinutes: task.estimatedMinutes ?? task.estimated_minutes ?? null,
  actualMinutes: task.actualMinutes ?? task.actual_minutes ?? null,
  dueDate: task.dueDate ?? task.due_date ?? null,
  memo: task.memo ?? null,
  tags: task.tags ?? [],
  createdAt: task.createdAt ?? task.created_at ?? '',
  updatedAt: task.updatedAt ?? task.updated_at ?? '',
});

const normalizeNote = (note: NoteResponse): Note => ({
  id: note.id,
  title: note.title ?? '',
  content: note.content,
  createdAt: note.createdAt ?? note.created_at ?? '',
  updatedAt: note.updatedAt ?? note.updated_at ?? '',
  revision: note.revision ?? 0,
  clientId: note.clientId ?? note.client_id,
});

type TaskMutationResponse = {
  message: string;
  updatedTask?: TaskResponse;
  updated_task?: TaskResponse;
  deletedTask?: TaskResponse;
  deleted_task?: TaskResponse;
};

const toTaskUpdateRequest = (body: Partial<Task>) => ({
  ...(body.taskName !== undefined ? { task_name: body.taskName } : {}),
  ...(body.category !== undefined ? { category: body.category } : {}),
  ...(body.difficultyLevel !== undefined ? { difficulty_level: body.difficultyLevel } : {}),
  ...(body.status !== undefined ? { status: body.status } : {}),
  ...(body.estimatedMinutes !== undefined ? { estimated_minutes: body.estimatedMinutes } : {}),
  ...(body.actualMinutes !== undefined ? { actual_minutes: body.actualMinutes } : {}),
  ...(body.dueDate !== undefined ? { due_date: body.dueDate } : {}),
  ...(body.memo !== undefined ? { memo: body.memo } : {}),
  ...(body.tags !== undefined ? { tags: body.tags } : {}),
});

const normalizeChatMessage = (message: ChatMessageResponse): ChatMessage => ({
  id: message.id,
  sender: message.sender,
  message: message.message,
  timestamp: message.timestamp ?? message.created_at ?? '',
});

const normalizeCanvas = (canvas: CanvasResponse): CanvasData => ({
  lines: Array.isArray(canvas.lines) ? (canvas.lines as CanvasLine[]) : [],
  images: Array.isArray(canvas.images) ? (canvas.images as CanvasImage[]) : [],
  textBoxes: Array.isArray(canvas.textBoxes)
    ? canvas.textBoxes
    : Array.isArray(canvas.text_boxes)
      ? canvas.text_boxes
      : [],
});

const normalizeCanvasFolder = (folder: CanvasFolderResponse): CanvasFolder => ({
  ...folder,
  canvasIds: folder.canvasIds ?? folder.canvas_ids ?? [],
});

const canvasQuery = (canvasId?: string | null) =>
  canvasId ? `?canvasId=${encodeURIComponent(canvasId)}` : '';

const appendUploadFile = async (
  formData: FormData,
  input: { uri: string; fileName?: string | null; mimeType?: string | null; file?: File | null }
) => {
  const name = input.fileName || `canvas-${Date.now()}.jpg`;
  const type = input.mimeType || input.file?.type || 'image/jpeg';

  if (input.file) {
    formData.append('image', input.file, name);
    return;
  }

  if (
    typeof Blob !== 'undefined'
    && typeof fetch === 'function'
    && (input.uri.startsWith('blob:') || input.uri.startsWith('data:'))
  ) {
    const blob = await fetch(input.uri).then((response) => response.blob());
    formData.append('image', blob, name);
    return;
  }

  formData.append('image', {
    uri: input.uri,
    name,
    type,
  } as unknown as Blob);
};

export const flownoteApi = {
  baseUrl: apiBaseUrl,
  getMobileConfig: async () => {
    const config = await request<MobileConfigResponse>('/api/mobile/config');

    return {
      coreApiUrl: config.coreApiUrl ?? config.core_api_url ?? '',
      aiApiUrl: config.aiApiUrl ?? config.ai_api_url ?? '',
      webUrl: config.webUrl ?? config.web_url ?? '',
      minimumSupportedVersion:
        config.minimumSupportedVersion ?? config.minimum_supported_version ?? '',
      enabledFeatures: config.enabledFeatures ?? config.enabled_features ?? [],
    };
  },
  login: (email: string, password: string) =>
    request<LoginResponse>('/api/users/login', {
      method: 'POST',
      body: { email, password },
    }),
  register: (input: { username: string; email: string; password: string; nickname: string }) =>
    request<FlownoteUser>('/api/users', {
      method: 'POST',
      body: input,
    }),
  listTasks: async (token: string) => {
    const tasks = await request<TaskResponse[]>('/api/tasks', { token });
    return tasks.map(normalizeTask);
  },
  createTask: async (token: string, input: CreateTaskInput) => {
    const task = await request<TaskResponse>('/api/tasks', {
      method: 'POST',
      token,
      body: {
        id: makeUuid(),
        taskName: input.taskName,
        category: input.category || 'Mobile',
        difficultyLevel: input.difficultyLevel ?? 1,
        status: input.status || 'TODO',
        estimatedMinutes: input.estimatedMinutes ?? 30,
        dueDate: input.dueDate || undefined,
        memo: input.memo || '',
        tags: input.tags ?? ['mobile'],
      },
    });
    return normalizeTask(task);
  },
  updateTask: async (token: string, id: string, body: Partial<Task>) => {
    const result = await request<TaskMutationResponse>(`/api/tasks/${id}`, {
      method: 'PATCH',
      token,
      body: toTaskUpdateRequest(body),
    });
    const updatedTask = result.updatedTask ?? result.updated_task;
    return {
      message: result.message,
      updatedTask: updatedTask ? normalizeTask(updatedTask) : undefined,
    };
  },
  deleteTask: (token: string, id: string) =>
    request<TaskMutationResponse>(`/api/tasks/${id}`, {
      method: 'DELETE',
      token,
    }),
  listNotes: async (token: string) => {
    const notes = await request<NoteResponse[]>('/api/notes', { token });
    return notes.map(normalizeNote);
  },
  getNote: async (token: string, id: string) => normalizeNote(await request<NoteResponse>(`/api/notes/${encodeURIComponent(id)}`, { token })),
  createNote: async (token: string, input: CreateNoteInput) => {
    const note = await request<NoteResponse>('/api/notes', {
      method: 'POST',
      token,
      body: {
        id: input.id ?? makeUuid(),
        title: input.title,
        content: input.content,
        createdAt: input.createdAt ?? new Date().toISOString(),
        revision: (input.revision ?? 0) + 1,
        client_id: makeUuid(),
      },
    });
    return normalizeNote(note);
  },
  deleteNote: (token: string, id: string) =>
    request<NoteResponse>(`/api/notes/${id}`, {
      method: 'DELETE',
      token,
    }),
  listChatMessages: async (token: string) => {
    const messages = await request<ChatMessageResponse[]>('/api/chat', { token });
    return messages.map(normalizeChatMessage);
  },
  createChatMessage: async (token: string, input: { sender: string; message: string }) => {
    const message = await request<ChatMessageResponse>('/api/chat', {
      method: 'POST',
      token,
      body: {
        id: makeUuid(),
        sender: input.sender,
        message: input.message,
        timestamp: new Date().toISOString(),
      },
    });
    return normalizeChatMessage(message);
  },
  askAgent: async (userText: string) => {
    const config = await flownoteApi.getMobileConfig();
    const response = await request<string>('/api/aiclient/ask_stream', {
      method: 'POST',
      baseUrl: config.aiApiUrl,
      body: { user_text: userText },
    });
    return String(response ?? '').trim();
  },
  listCanvasDocuments: async (token: string) => {
    const documents = await request<CanvasDocumentSummary[]>('/api/canvas/documents', { token });
    return Array.isArray(documents) ? documents : [];
  },
  createCanvasDocument: (token: string, title: string) =>
    request<CanvasDocumentSummary>('/api/canvas/documents', {
      method: 'POST',
      token,
      body: { title },
    }),
  updateCanvasDocument: (token: string, id: string, title: string) =>
    request<CanvasDocumentSummary>(`/api/canvas/documents/${id}`, {
      method: 'PATCH',
      token,
      body: { title },
    }),
  deleteCanvasDocument: (token: string, id: string) =>
    request<void>(`/api/canvas/documents/${id}`, {
      method: 'DELETE',
      token,
    }),
  uploadCanvasImage: async (
    token: string,
    input: { uri: string; fileName?: string | null; mimeType?: string | null; file?: File | null }
  ) => {
    const formData = new FormData();
    await appendUploadFile(formData, input);

    const baseUrl = apiBaseUrl();
    const response = await fetchWithTimeout(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    const data = await response.json().catch(() => null) as { fileUrl?: string; filename?: string; message?: string; error?: string } | null;

    if (!response.ok) {
      throw new FlownoteApiError(response.status, data?.message ?? data?.error ?? `업로드에 실패했습니다. (${response.status})`);
    }

    const fileUrl = data?.fileUrl ?? (data?.filename ? `/uploads/${data.filename}` : null);
    if (!fileUrl) {
      throw new Error('업로드 응답에 파일 URL이 없습니다.');
    }

    return fileUrl.startsWith('http') ? fileUrl : `${baseUrl}${fileUrl}`;
  },
  listCanvasFolders: async (token: string) => {
    const folders = await request<CanvasFolderResponse[]>('/api/canvas/folders', { token });
    return Array.isArray(folders) ? folders.map(normalizeCanvasFolder) : [];
  },
  createCanvasFolder: async (token: string, input: { category: string; name: string }) => {
    const folder = await request<CanvasFolderResponse>('/api/canvas/folders', {
      method: 'POST',
      token,
      body: input,
    });
    return normalizeCanvasFolder(folder);
  },
  updateCanvasFolder: async (token: string, folderId: string, input: { category: string; name: string }) => {
    const folder = await request<CanvasFolderResponse>(`/api/canvas/folders/${folderId}`, {
      method: 'PATCH',
      token,
      body: input,
    });
    return normalizeCanvasFolder(folder);
  },
  deleteCanvasFolder: (token: string, folderId: string) =>
    request<void>(`/api/canvas/folders/${folderId}`, {
      method: 'DELETE',
      token,
    }),
  addCanvasToFolder: async (token: string, folderId: string, canvasId: string) => {
    const folder = await request<CanvasFolderResponse>(
      `/api/canvas/folders/${folderId}/documents/${canvasId}`,
      { method: 'POST', token }
    );
    return normalizeCanvasFolder(folder);
  },
  removeCanvasFromFolder: async (token: string, folderId: string, canvasId: string) => {
    const folder = await request<CanvasFolderResponse>(
      `/api/canvas/folders/${folderId}/documents/${canvasId}`,
      { method: 'DELETE', token }
    );
    return normalizeCanvasFolder(folder);
  },
  loadCanvas: async (token: string, canvasId?: string | null) => {
    const canvas = await request<CanvasResponse>(`/api/canvas/load${canvasQuery(canvasId)}`, { token });
    return normalizeCanvas(canvas);
  },
  saveCanvasElements: async (
    token: string,
    input: {
      lines: CanvasLine[];
      images?: CanvasImage[];
      textBoxes: CanvasTextBox[];
      deletedLineIds?: string[];
      deletedImageIds?: string[];
      deletedTextBoxIds?: string[];
      canvasId?: string | null;
    }
  ) => {
    await request('/api/canvas/save', {
      method: 'POST',
      token,
      body: {
        canvasId: input.canvasId,
        mutationId: makeUuid(),
        payload: {
        addedLines: input.lines,
        modifiedLines: [],
        deletedLines: (input.deletedLineIds ?? []).map((id) => ({ id })),
        addedImages: input.images ?? [],
        modifiedImages: [],
        deletedImages: (input.deletedImageIds ?? []).map((id) => ({ id })),
        addedTextBoxes: input.textBoxes,
        modifiedTextBoxes: [],
        deletedTextBoxes: (input.deletedTextBoxIds ?? []).map((id) => ({ id })),
        },
      },
    });
    return flownoteApi.loadCanvas(token, input.canvasId);
  },
  saveCanvasTextBoxes: async (token: string, textBoxes: CanvasTextBox[], deletedTextBoxIds: string[] = []) =>
    flownoteApi.saveCanvasElements(token, {
      lines: [],
      textBoxes,
      deletedTextBoxIds,
    }),
};

export { FlownoteApiError };
