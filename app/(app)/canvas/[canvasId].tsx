import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Circle, G, Image as SvgImage, Path, Polyline, Rect, Text as SvgText, TSpan } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/context/session-context';
import {
  flownoteApi,
  type CanvasDocumentSummary,
  type CanvasFolder,
  type CanvasImage,
  type CanvasLine,
  type CanvasPoint,
  type CanvasTextBox,
} from '@/lib/flownote-api';

type Tool = 'pen' | 'eraser' | 'lasso' | 'handle' | 'text';
type ToolConfig = {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
};

type CanvasLocalDraft = {
  lines: CanvasLine[];
  images: CanvasImage[];
  textBoxes: CanvasTextBox[];
  deletedLineIds: string[];
  deletedImageIds: string[];
  deletedTextBoxIds: string[];
  updatedAt: number;
  hasPendingChanges: boolean;
};

type LassoSelection = {
  lineIds: Set<string>;
  imageIds: Set<string>;
  textBoxIds: Set<string>;
};

const TOOL_CONFIG: Record<Tool, ToolConfig> = {
  pen: { icon: 'edit', label: '펜' },
  eraser: { icon: 'auto-fix-normal', label: '지우개' },
  lasso: { icon: 'gesture', label: '올가미' },
  handle: { icon: 'pan-tool-alt', label: '이동' },
  text: { icon: 'text-fields', label: '텍스트' },
};

const CANVAS_VIEWPORT_STORAGE_KEY = 'flownote.mobile.canvas.viewport';
const CANVAS_PEN_COLOR_STORAGE_KEY = 'flownote.mobile.canvas.penColor';
const CANVAS_LOCAL_DRAFT_STORAGE_KEY = 'flownote.mobile.canvas.localDraft';
const CANVAS_LIBRARY_VISIBLE_STORAGE_KEY = 'flownote.mobile.canvas.libraryVisible';
const CANVAS_AUTOSAVE_DELAY_MS = 700;
const DEFAULT_PEN_COLOR = '#1F2937';
const PEN_COLORS = [
  { label: '검정', value: '#1F2937' },
  { label: '빨강', value: '#DC2626' },
  { label: '파랑', value: '#2563EB' },
  { label: '초록', value: '#16A34A' },
  { label: '노랑', value: '#D97706' },
  { label: '보라', value: '#7C3AED' },
];

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const distance = (a: CanvasPoint, b: CanvasPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const splitTextLines = (text: string) => (text.trim() ? text.split(/\r?\n/) : ['Text']);
const MIN_DRAW_POINT_DISTANCE = 0.8;
const MAX_DRAW_POINT_DISTANCE = 8;

const interpolatePoint = (start: CanvasPoint, end: CanvasPoint, ratio: number): CanvasPoint => ({
  x: start.x + (end.x - start.x) * ratio,
  y: start.y + (end.y - start.y) * ratio,
});

const appendDrawPoint = (points: CanvasPoint[], next: CanvasPoint) => {
  const previous = points.at(-1);
  if (!previous) return [next];

  const gap = distance(previous, next);
  if (gap < MIN_DRAW_POINT_DISTANCE) return points;

  const interpolated: CanvasPoint[] = [];
  const steps = Math.floor(gap / MAX_DRAW_POINT_DISTANCE);
  for (let step = 1; step <= steps; step += 1) {
    interpolated.push(interpolatePoint(previous, next, step / (steps + 1)));
  }

  return [...points, ...interpolated, next];
};

const smoothLinePoints = (points: CanvasPoint[]) => {
  if (points.length <= 2) return points;

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    const previous = points[index - 1];
    const next = points[index + 1];
    return {
      x: point.x * 0.5 + (previous.x + next.x) * 0.25,
      y: point.y * 0.5 + (previous.y + next.y) * 0.25,
    };
  });
};

const lineToSmoothPath = (points: CanvasPoint[]) => {
  if (points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x} ${point.y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }

  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
};

const pointNearLine = (point: CanvasPoint, line: CanvasLine, radius: number) =>
  line.points.some((linePoint) => distance(point, linePoint) < radius);

const pointInTextBox = (point: CanvasPoint, box: CanvasTextBox) => {
  const width = box.width ?? 160;
  const height = box.height ?? 64;
  return point.x >= box.x && point.x <= box.x + width && point.y >= box.y && point.y <= box.y + height;
};

const pointInImage = (point: CanvasPoint, image: CanvasImage) =>
  point.x >= image.x && point.x <= image.x + image.width && point.y >= image.y && point.y <= image.y + image.height;

const isPointInPolygon = (point: CanvasPoint, polygon: CanvasPoint[]) => {
  if (polygon.length < 3) return false;
  let inside = false;

  for (let currentIndex = 0, previousIndex = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || 1) + current.x;
    if (intersects) inside = !inside;
  }

  return inside;
};

const lineHitsPolygon = (line: CanvasLine, polygon: CanvasPoint[]) =>
  line.points.some((point) => isPointInPolygon(point, polygon));

const selectionCount = (selection: LassoSelection | null) =>
  selection ? selection.lineIds.size + selection.imageIds.size + selection.textBoxIds.size : 0;

const selectionBounds = (
  selection: LassoSelection | null,
  lines: CanvasLine[],
  images: CanvasImage[],
  textBoxes: CanvasTextBox[]
) => {
  if (!selection || selectionCount(selection) === 0) return null;

  const points: CanvasPoint[] = [];
  lines.forEach((line) => {
    if (selection.lineIds.has(line.id)) points.push(...line.points);
  });
  images.forEach((image) => {
    if (selection.imageIds.has(image.id)) {
      points.push({ x: image.x, y: image.y }, { x: image.x + image.width, y: image.y + image.height });
    }
  });
  textBoxes.forEach((box) => {
    if (selection.textBoxIds.has(box.id)) {
      const width = box.width ?? 170;
      const height = box.height ?? 72;
      points.push({ x: box.x, y: box.y }, { x: box.x + width, y: box.y + height });
    }
  });

  if (points.length === 0) return null;

  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
};

const isPointInsideBounds = (
  point: CanvasPoint,
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null
) => Boolean(bounds && point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY);

const sortById = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));

const normalizeCanvasForCompare = (input: Pick<CanvasLocalDraft, 'lines' | 'images' | 'textBoxes'>) =>
  JSON.stringify({
    lines: sortById(input.lines),
    images: sortById(input.images),
    textBoxes: sortById(input.textBoxes),
  });

const buildCanvasLocalDraft = (
  lines: CanvasLine[],
  images: CanvasImage[],
  textBoxes: CanvasTextBox[],
  deletedLineIds: string[],
  deletedImageIds: string[],
  deletedTextBoxIds: string[],
  hasPendingChanges: boolean
): CanvasLocalDraft => ({
  lines,
  images,
  textBoxes,
  deletedLineIds,
  deletedImageIds,
  deletedTextBoxIds,
  updatedAt: Date.now(),
  hasPendingChanges,
});

export default function CanvasScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ canvasId: string }>();
  const routeCanvasId = Array.isArray(params.canvasId) ? params.canvasId[0] : params.canvasId;
  const { token, loading: sessionLoading } = useSession();
  const [tool, setTool] = useState<Tool>('pen');
  const [canvasDocuments, setCanvasDocuments] = useState<CanvasDocumentSummary[]>([]);
  const [canvasFolders, setCanvasFolders] = useState<CanvasFolder[]>([]);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(routeCanvasId ?? null);
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [folderName, setFolderName] = useState('');
  const [folderCategory, setFolderCategory] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [editingFolderCategory, setEditingFolderCategory] = useState('');
  const [editingCanvasTitle, setEditingCanvasTitle] = useState('');
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [lines, setLines] = useState<CanvasLine[]>([]);
  const [images, setImages] = useState<CanvasImage[]>([]);
  const [textBoxes, setTextBoxes] = useState<CanvasTextBox[]>([]);
  const [deletedLineIds, setDeletedLineIds] = useState<string[]>([]);
  const [deletedImageIds, setDeletedImageIds] = useState<string[]>([]);
  const [deletedTextBoxIds, setDeletedTextBoxIds] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState<CanvasPoint[]>([]);
  const [currentLasso, setCurrentLasso] = useState<CanvasPoint[]>([]);
  const [lassoSelection, setLassoSelection] = useState<LassoSelection | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewport, setViewport] = useState({ scale: 1, translateX: 0, translateY: 0 });
  const [boardSize, setBoardSize] = useState({ width: 0, height: 0 });
  const [penColor, setPenColor] = useState(DEFAULT_PEN_COLOR);
  const viewportRef = useRef(viewport);
  const viewportGestureRef = useRef<{
    previousDistance: number;
    previousCenter: CanvasPoint;
  } | null>(null);
  const isViewportGestureRef = useRef(false);
  const suppressSingleTouchRef = useRef(false);
  const draggingTextRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const draggingImageRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const lassoDragStartRef = useRef<CanvasPoint | null>(null);
  const historyRef = useRef<
    {
      lines: CanvasLine[];
      images: CanvasImage[];
      textBoxes: CanvasTextBox[];
      deletedLineIds: string[];
      deletedImageIds: string[];
      deletedTextBoxIds: string[];
    }[]
  >([]);
  const tokenRef = useRef(token);
  const selectedCanvasIdRef = useRef(selectedCanvasId);
  const linesRef = useRef(lines);
  const imagesRef = useRef(images);
  const textBoxesRef = useRef(textBoxes);
  const deletedLineIdsRef = useRef(deletedLineIds);
  const deletedImageIdsRef = useRef(deletedImageIds);
  const deletedTextBoxIdsRef = useRef(deletedTextBoxIds);
  const hasLoadedCanvasRef = useRef(false);
  const hasPendingChangesRef = useRef(false);
  const suppressNextDraftDirtyRef = useRef(false);
  const localRevisionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const saveAgainRequestedRef = useRef(false);

  const selectedTextBox = useMemo(
    () => textBoxes.find((box) => box.id === selectedTextId) ?? null,
    [selectedTextId, textBoxes]
  );
  const lassoSelectionCount = useMemo(() => selectionCount(lassoSelection), [lassoSelection]);
  const lassoSelectionBounds = useMemo(
    () => selectionBounds(lassoSelection, lines, images, textBoxes),
    [images, lassoSelection, lines, textBoxes]
  );
  const canvasFolderIdByCanvasId = useMemo(() => {
    const entries = canvasFolders.flatMap((folder) =>
      folder.canvasIds.map((canvasId) => [canvasId, folder.id] as const)
    );
    return new Map(entries);
  }, [canvasFolders]);
  const unfiledCanvases = useMemo(
    () => canvasDocuments.filter((document) => !canvasFolderIdByCanvasId.has(document.id)),
    [canvasDocuments, canvasFolderIdByCanvasId]
  );
  const canvasFoldersByCategory = useMemo(
    () =>
      canvasFolders.reduce<Record<string, CanvasFolder[]>>((acc, folder) => {
        const category = folder.category.trim() || '카테고리 없음';
        acc[category] = [...(acc[category] ?? []), folder];
        return acc;
      }, {}),
    [canvasFolders]
  );

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    selectedCanvasIdRef.current = selectedCanvasId;
  }, [selectedCanvasId]);

  useEffect(() => {
    if (routeCanvasId && routeCanvasId !== selectedCanvasIdRef.current) {
      setSelectedCanvasId(routeCanvasId);
    }
  }, [routeCanvasId]);

  const setSyncedViewport = useCallback((nextViewport: typeof viewport) => {
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
    void AsyncStorage.setItem(CANVAS_VIEWPORT_STORAGE_KEY, JSON.stringify(nextViewport));
  }, []);

  const viewportTransform = useMemo(
    () =>
      `matrix(${viewport.scale} 0 0 ${viewport.scale} ${viewport.translateX} ${viewport.translateY})`,
    [viewport]
  );

  const viewportCenter = useMemo(
    () => ({
      x: ((boardSize.width || 1800) / 2 - viewport.translateX) / viewport.scale,
      y: ((boardSize.height || 1800) / 2 - viewport.translateY) / viewport.scale,
    }),
    [boardSize.height, boardSize.width, viewport]
  );

  const resetViewport = () => {
    setSyncedViewport({ scale: 1, translateX: 0, translateY: 0 });
  };

  const updateBoardSize = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBoardSize({ width, height });
  };

  const selectPenColor = (color: string) => {
    setPenColor(color);
    setTool('pen');
    void AsyncStorage.setItem(CANVAS_PEN_COLOR_STORAGE_KEY, color);
  };

  const recordHistory = () => {
    historyRef.current = [
      ...historyRef.current,
      { lines, images, textBoxes, deletedLineIds, deletedImageIds, deletedTextBoxIds },
    ].slice(-20);
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) {
      return;
    }

    setLines(previous.lines);
    setImages(previous.images);
    setTextBoxes(previous.textBoxes);
    setDeletedLineIds(previous.deletedLineIds);
    setDeletedImageIds(previous.deletedImageIds);
    setDeletedTextBoxIds(previous.deletedTextBoxIds);
  };

  const writeLocalDraft = useCallback(async (hasPendingChanges: boolean) => {
    const canvasId = selectedCanvasIdRef.current ?? 'default';
    const draft = buildCanvasLocalDraft(
      linesRef.current,
      imagesRef.current,
      textBoxesRef.current,
      deletedLineIdsRef.current,
      deletedImageIdsRef.current,
      deletedTextBoxIdsRef.current,
      hasPendingChanges
    );
    await AsyncStorage.setItem(`${CANVAS_LOCAL_DRAFT_STORAGE_KEY}.${canvasId}`, JSON.stringify(draft));
  }, []);

  const readLocalDraft = useCallback(async (canvasId?: string | null): Promise<CanvasLocalDraft | null> => {
    try {
      const raw = await AsyncStorage.getItem(`${CANVAS_LOCAL_DRAFT_STORAGE_KEY}.${canvasId ?? 'default'}`);
      if (!raw) return null;
      const draft = JSON.parse(raw) as Partial<CanvasLocalDraft>;
      if (!Array.isArray(draft.lines) || !Array.isArray(draft.textBoxes)) return null;
      return {
        lines: draft.lines,
        images: Array.isArray(draft.images) ? draft.images : [],
        textBoxes: draft.textBoxes,
        deletedLineIds: Array.isArray(draft.deletedLineIds) ? draft.deletedLineIds : [],
        deletedImageIds: Array.isArray(draft.deletedImageIds) ? draft.deletedImageIds : [],
        deletedTextBoxIds: Array.isArray(draft.deletedTextBoxIds) ? draft.deletedTextBoxIds : [],
        updatedAt: typeof draft.updatedAt === 'number' ? draft.updatedAt : 0,
        hasPendingChanges: Boolean(draft.hasPendingChanges),
      };
    } catch {
      return null;
    }
  }, []);

  const applyCanvasState = useCallback((draft: Pick<CanvasLocalDraft, 'lines' | 'images' | 'textBoxes' | 'deletedLineIds' | 'deletedImageIds' | 'deletedTextBoxIds'>, hasPendingChanges: boolean) => {
    suppressNextDraftDirtyRef.current = !hasPendingChanges;
    hasPendingChangesRef.current = hasPendingChanges;
    setLines(draft.lines);
    setImages(draft.images);
    setTextBoxes(draft.textBoxes);
    setDeletedLineIds(draft.deletedLineIds);
    setDeletedImageIds(draft.deletedImageIds);
    setDeletedTextBoxIds(draft.deletedTextBoxIds);
  }, []);

  const verifyAndReconcileServer = useCallback(async (activeToken: string) => {
    const canvasId = selectedCanvasIdRef.current;
    const local = {
      lines: linesRef.current,
      images: imagesRef.current,
      textBoxes: textBoxesRef.current,
    };
    const server = await flownoteApi.loadCanvas(activeToken, canvasId);
    if (normalizeCanvasForCompare(local) === normalizeCanvasForCompare(server)) return;

    const localLineIds = new Set(local.lines.map((line) => line.id));
    const localImageIds = new Set(local.images.map((image) => image.id));
    const localTextBoxIds = new Set(local.textBoxes.map((box) => box.id));
    await flownoteApi.saveCanvasElements(activeToken, {
      lines: local.lines,
      images: local.images,
      textBoxes: local.textBoxes,
      deletedLineIds: [
        ...deletedLineIdsRef.current,
        ...server.lines.filter((line) => !localLineIds.has(line.id)).map((line) => line.id),
      ],
      deletedImageIds: [
        ...deletedImageIdsRef.current,
        ...server.images.filter((image) => !localImageIds.has(image.id)).map((image) => image.id),
      ],
      deletedTextBoxIds: [
        ...deletedTextBoxIdsRef.current,
        ...server.textBoxes.filter((box) => !localTextBoxIds.has(box.id)).map((box) => box.id),
      ],
      canvasId,
    });
  }, []);

  const loadCanvasLibrary = useCallback(async () => {
    if (!token) {
      setCanvasDocuments([]);
      setCanvasFolders([]);
      setSelectedCanvasId(null);
      return;
    }

    setLibraryError(null);
    try {
      let documents = await flownoteApi.listCanvasDocuments(token);
      const folders = await flownoteApi.listCanvasFolders(token);
      if (documents.length === 0) {
        const created = await flownoteApi.createCanvasDocument(token, '기본 캔버스');
        documents = [created];
      }
      setCanvasDocuments(documents);
      setCanvasFolders(folders);
      setSelectedCanvasId((current) => {
        if (current && documents.some((document) => document.id === current)) return current;
        return documents[0]?.id ?? null;
      });
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : '캔버스 목록을 불러오지 못했습니다.');
    }
  }, [token]);

  useEffect(() => {
    linesRef.current = lines;
    imagesRef.current = images;
    textBoxesRef.current = textBoxes;
    deletedLineIdsRef.current = deletedLineIds;
    deletedImageIdsRef.current = deletedImageIds;
    deletedTextBoxIdsRef.current = deletedTextBoxIds;
    localRevisionRef.current += 1;

    if (!hasLoadedCanvasRef.current) return;
    const hasPendingChanges = !suppressNextDraftDirtyRef.current;
    suppressNextDraftDirtyRef.current = false;
    hasPendingChangesRef.current = hasPendingChanges;
    void writeLocalDraft(hasPendingChanges);
  }, [deletedImageIds, deletedLineIds, deletedTextBoxIds, images, lines, textBoxes, writeLocalDraft]);

  const load = useCallback(async () => {
    if (!token) {
      setLines([]);
      setImages([]);
      setTextBoxes([]);
      hasLoadedCanvasRef.current = false;
      return;
    }
    if (!selectedCanvasId) {
      return;
    }

    setLoading(true);
    const localDraft = await readLocalDraft(selectedCanvasId);
    try {
      const canvas = await flownoteApi.loadCanvas(token, selectedCanvasId);
      hasLoadedCanvasRef.current = true;
      if (localDraft?.hasPendingChanges) {
        applyCanvasState(localDraft, true);
      } else {
        applyCanvasState({
          lines: canvas.lines,
          images: canvas.images,
          textBoxes: canvas.textBoxes,
          deletedLineIds: [],
          deletedImageIds: [],
          deletedTextBoxIds: [],
        }, false);
      }
      historyRef.current = [];
    } catch (error) {
      if (localDraft) {
        hasLoadedCanvasRef.current = true;
        applyCanvasState(localDraft, localDraft.hasPendingChanges);
      } else {
        Alert.alert('Flownote Canvas', error instanceof Error ? error.message : '캔버스를 불러오지 못했습니다.');
      }
    } finally {
      setLoading(false);
    }
  }, [applyCanvasState, readLocalDraft, selectedCanvasId, token]);

  useEffect(() => {
    void loadCanvasLibrary();
  }, [loadCanvasLibrary]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const loadCanvasPreferences = async () => {
      const [storedViewport, storedPenColor] = await Promise.all([
        AsyncStorage.getItem(CANVAS_VIEWPORT_STORAGE_KEY),
        AsyncStorage.getItem(CANVAS_PEN_COLOR_STORAGE_KEY),
      ]);

      if (storedViewport) {
        try {
          const parsed = JSON.parse(storedViewport) as Partial<typeof viewport>;
          if (
            typeof parsed.scale === 'number'
            && typeof parsed.translateX === 'number'
            && typeof parsed.translateY === 'number'
          ) {
            setSyncedViewport({
              scale: clamp(parsed.scale, 0.4, 4),
              translateX: parsed.translateX,
              translateY: parsed.translateY,
            });
          }
        } catch {
          await AsyncStorage.removeItem(CANVAS_VIEWPORT_STORAGE_KEY);
        }
      }

      if (storedPenColor) {
        setPenColor(storedPenColor);
      }

    };

    void loadCanvasPreferences();
  }, [setSyncedViewport]);

  useEffect(() => {
    setDraftText(selectedTextBox?.text ?? '');
  }, [selectedTextBox]);

  const save = useCallback(async (options: { silent?: boolean } = {}) => {
    const activeToken = tokenRef.current;
    const canvasId = selectedCanvasIdRef.current;
    if (!activeToken) {
      return;
    }

    if (options.silent && !hasPendingChangesRef.current) {
      return;
    }

    if (saveInFlightRef.current) {
      saveAgainRequestedRef.current = true;
      return;
    }

    saveInFlightRef.current = true;
    if (!options.silent) setSaving(true);
    try {
      do {
        saveAgainRequestedRef.current = false;
        const revisionAtSaveStart = localRevisionRef.current;
        const canvas = await flownoteApi.saveCanvasElements(activeToken, {
          lines: linesRef.current,
          images: imagesRef.current,
          textBoxes: textBoxesRef.current,
          deletedLineIds: deletedLineIdsRef.current,
          deletedImageIds: deletedImageIdsRef.current,
          deletedTextBoxIds: deletedTextBoxIdsRef.current,
          canvasId,
        });

        if (localRevisionRef.current !== revisionAtSaveStart) {
          saveAgainRequestedRef.current = true;
          continue;
        }

        await verifyAndReconcileServer(activeToken);
        applyCanvasState({
          lines: canvas.lines,
          images: canvas.images,
          textBoxes: canvas.textBoxes,
          deletedLineIds: [],
          deletedImageIds: [],
          deletedTextBoxIds: [],
        }, false);
        await writeLocalDraft(false);
      } while (saveAgainRequestedRef.current);
    } catch (error) {
      if (!options.silent) {
        Alert.alert('Flownote Canvas', error instanceof Error ? error.message : '캔버스를 저장하지 못했습니다.');
      }
    } finally {
      saveInFlightRef.current = false;
      if (!options.silent) setSaving(false);
    }
  }, [applyCanvasState, verifyAndReconcileServer, writeLocalDraft]);

  const selectCanvas = (canvasId: string) => {
    void writeLocalDraft(hasPendingChangesRef.current);
    void save({ silent: true });
    setSelectedCanvasId(canvasId);
    setSelectedTextId(null);
    setCurrentLine([]);
    setCurrentLasso([]);
    setLassoSelection(null);
    router.replace({ pathname: '/canvas/[canvasId]', params: { canvasId } });
  };

  const createCanvas = async (folderId?: string) => {
    const activeToken = tokenRef.current;
    if (!activeToken) return;
    try {
      const created = await flownoteApi.createCanvasDocument(activeToken, `새 캔버스_${Date.now()}`);
      setCanvasDocuments((current) => [created, ...current]);
      if (folderId) {
        const updated = await flownoteApi.addCanvasToFolder(activeToken, folderId, created.id);
        setCanvasFolders((current) => current.map((folder) => (folder.id === updated.id ? updated : folder)));
      }
      selectCanvas(created.id);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : '캔버스를 만들지 못했습니다.');
    }
  };

  const createFolder = async () => {
    const activeToken = tokenRef.current;
    if (!activeToken || !folderName.trim()) return;
    try {
      const created = await flownoteApi.createCanvasFolder(activeToken, {
        category: folderCategory.trim(),
        name: folderName.trim(),
      });
      setCanvasFolders((current) => [created, ...current]);
      setFolderCategory('');
      setFolderName('');
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : '폴더를 만들지 못했습니다.');
    }
  };

  const beginEditFolder = (folder: CanvasFolder) => {
    setEditingFolderId(folder.id);
    setEditingFolderCategory(folder.category);
    setEditingFolderName(folder.name);
  };

  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const updateFolder = async () => {
    const activeToken = tokenRef.current;
    if (!activeToken || !editingFolderId || !editingFolderName.trim()) return;
    try {
      const updated = await flownoteApi.updateCanvasFolder(activeToken, editingFolderId, {
        category: editingFolderCategory.trim(),
        name: editingFolderName.trim(),
      });
      setCanvasFolders((current) => current.map((folder) => (folder.id === updated.id ? updated : folder)));
      setEditingFolderId(null);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : '폴더를 수정하지 못했습니다.');
    }
  };

  const deleteFolder = async (folderId: string) => {
    const activeToken = tokenRef.current;
    if (!activeToken) return;
    try {
      await flownoteApi.deleteCanvasFolder(activeToken, folderId);
      setCanvasFolders((current) => current.filter((folder) => folder.id !== folderId));
      if (editingFolderId === folderId) {
        setEditingFolderId(null);
      }
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : '폴더를 삭제하지 못했습니다.');
    }
  };

  const beginEditCanvas = (document: CanvasDocumentSummary) => {
    setEditingCanvasId(document.id);
    setEditingCanvasTitle(document.title);
  };

  const updateCanvasTitle = async () => {
    const activeToken = tokenRef.current;
    if (!activeToken || !editingCanvasId || !editingCanvasTitle.trim()) return;
    try {
      const updated = await flownoteApi.updateCanvasDocument(activeToken, editingCanvasId, editingCanvasTitle.trim());
      setCanvasDocuments((current) => current.map((document) => (document.id === updated.id ? updated : document)));
      setEditingCanvasId(null);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : '캔버스 이름을 수정하지 못했습니다.');
    }
  };

  const moveCanvasToFolder = async (canvasId: string, folderId: string | null) => {
    const activeToken = tokenRef.current;
    if (!activeToken) return;
    const currentFolderId = canvasFolderIdByCanvasId.get(canvasId) ?? null;
    if (currentFolderId === folderId) return;

    try {
      if (folderId) {
        const updated = await flownoteApi.addCanvasToFolder(activeToken, folderId, canvasId);
        setCanvasFolders((current) => current.map((folder) => (
          folder.id === updated.id
            ? updated
            : { ...folder, canvasIds: folder.canvasIds.filter((id) => id !== canvasId) }
        )));
      } else if (currentFolderId) {
        const updated = await flownoteApi.removeCanvasFromFolder(activeToken, currentFolderId, canvasId);
        setCanvasFolders((current) => current.map((folder) => (folder.id === updated.id ? updated : folder)));
      }
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : '캔버스를 이동하지 못했습니다.');
    }
  };

  const renderMoveTargets = (document: CanvasDocumentSummary, currentFolderId: string | null) => {
    const targetFolders = canvasFolders.filter((folder) => folder.id !== currentFolderId);
    if (editingCanvasId === document.id || (targetFolders.length === 0 && !currentFolderId)) return null;

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moveTargetScroller}>
        {currentFolderId ? (
          <Pressable
            style={styles.moveTargetButton}
            onPress={() => void moveCanvasToFolder(document.id, null)}>
            <ThemedText numberOfLines={1} style={styles.moveTargetText}>최근</ThemedText>
          </Pressable>
        ) : null}
        {targetFolders.map((folder) => (
          <Pressable
            key={folder.id}
            style={styles.moveTargetButton}
            onPress={() => void moveCanvasToFolder(document.id, folder.id)}>
            <ThemedText numberOfLines={1} style={styles.moveTargetText}>{folder.name}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    );
  };

  const deleteCanvas = async (canvasId: string) => {
    const activeToken = tokenRef.current;
    if (!activeToken) return;
    try {
      await flownoteApi.deleteCanvasDocument(activeToken, canvasId);
      const deletingSelectedCanvas = selectedCanvasIdRef.current === canvasId;
      setCanvasDocuments((current) => {
        const next = current.filter((document) => document.id !== canvasId);
        if (deletingSelectedCanvas) {
          const nextCanvasId = next[0]?.id ?? null;
          setSelectedCanvasId(nextCanvasId);
          if (nextCanvasId) {
            router.replace({ pathname: '/canvas/[canvasId]', params: { canvasId: nextCanvasId } });
          } else {
            router.replace('/canvas');
          }
        }
        return next;
      });
      setCanvasFolders((current) => current.map((folder) => ({
        ...folder,
        canvasIds: folder.canvasIds.filter((id) => id !== canvasId),
      })));
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : '캔버스를 삭제하지 못했습니다.');
    }
  };

  const toggleLibraryVisible = () => {
    setLibraryVisible((current) => {
      const next = !current;
      void AsyncStorage.setItem(CANVAS_LIBRARY_VISIBLE_STORAGE_KEY, String(next));
      return next;
    });
  };

  useEffect(() => {
    if (!token || !hasLoadedCanvasRef.current) return undefined;
    const timeout = setTimeout(() => {
      void save({ silent: true });
    }, CANVAS_AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [deletedImageIds, deletedLineIds, deletedTextBoxIds, images, lines, save, textBoxes, token]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        void writeLocalDraft(hasPendingChangesRef.current);
        void save({ silent: true });
      }
    });

    return () => subscription.remove();
  }, [save, writeLocalDraft]);

  const getScreenPoint = (event: GestureResponderEvent): CanvasPoint => ({
    x: event.nativeEvent.locationX,
    y: event.nativeEvent.locationY,
  });

  const screenToCanvasPoint = (point: CanvasPoint): CanvasPoint => {
    const currentViewport = viewportRef.current;
    return {
      x: (point.x - currentViewport.translateX) / currentViewport.scale,
      y: (point.y - currentViewport.translateY) / currentViewport.scale,
    };
  };

  const getPoint = (event: GestureResponderEvent) => screenToCanvasPoint(getScreenPoint(event));

  const getTouches = (event: GestureResponderEvent): CanvasPoint[] =>
    Array.from(event.nativeEvent.touches ?? []).map((touch) => ({
      x: touch.locationX,
      y: touch.locationY,
    }));

  const getTouchCenter = ([first, second]: CanvasPoint[]) => ({
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  });

  const beginViewportGesture = (touches: CanvasPoint[]) => {
    const [first, second] = touches;
    if (!first || !second) {
      return;
    }

    viewportGestureRef.current = {
      previousDistance: Math.max(distance(first, second), 1),
      previousCenter: getTouchCenter(touches),
    };
    isViewportGestureRef.current = true;
    suppressSingleTouchRef.current = true;
    draggingTextRef.current = null;
    draggingImageRef.current = null;
    lassoDragStartRef.current = null;
    setCurrentLine([]);
    setCurrentLasso([]);
  };

  const updateViewportGesture = (touches: CanvasPoint[]) => {
    const [first, second] = touches;
    const gesture = viewportGestureRef.current;
    if (!first || !second || !gesture) {
      return;
    }

    const currentViewport = viewportRef.current;
    const currentDistance = Math.max(distance(first, second), 1);
    const currentCenter = getTouchCenter(touches);
    const nextScale = clamp(
      currentViewport.scale * (currentDistance / gesture.previousDistance),
      0.4,
      4
    );
    const zoomRatio = nextScale / currentViewport.scale;
    setSyncedViewport({
      scale: nextScale,
      translateX: currentCenter.x - (gesture.previousCenter.x - currentViewport.translateX) * zoomRatio,
      translateY: currentCenter.y - (gesture.previousCenter.y - currentViewport.translateY) * zoomRatio,
    });
    viewportGestureRef.current = {
      previousDistance: currentDistance,
      previousCenter: currentCenter,
    };
  };

  const eraseAt = (point: CanvasPoint) => {
    const eraseRadius = 18 / viewportRef.current.scale;
    const erasedLineIds = lines.filter((line) => pointNearLine(point, line, eraseRadius)).map((line) => line.id);
    const erasedImageIds = images.filter((image) => pointInImage(point, image)).map((image) => image.id);
    const erasedTextIds = textBoxes.filter((box) => pointInTextBox(point, box)).map((box) => box.id);

    if (erasedLineIds.length === 0 && erasedImageIds.length === 0 && erasedTextIds.length === 0) {
      return;
    }

    setLines((current) => current.filter((line) => !erasedLineIds.includes(line.id)));
    setImages((current) => current.filter((image) => !erasedImageIds.includes(image.id)));
    setTextBoxes((current) => current.filter((box) => !erasedTextIds.includes(box.id)));
    setDeletedLineIds((current) => Array.from(new Set([...current, ...erasedLineIds])));
    setDeletedImageIds((current) => Array.from(new Set([...current, ...erasedImageIds])));
    setDeletedTextBoxIds((current) => Array.from(new Set([...current, ...erasedTextIds])));
  };

  const moveLassoSelection = (deltaX: number, deltaY: number) => {
    if (!lassoSelection) return;

    setLines((current) =>
      current.map((line) =>
        lassoSelection.lineIds.has(line.id)
          ? { ...line, points: line.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })) }
          : line
      )
    );
    setImages((current) =>
      current.map((image) =>
        lassoSelection.imageIds.has(image.id)
          ? { ...image, x: image.x + deltaX, y: image.y + deltaY }
          : image
      )
    );
    setTextBoxes((current) =>
      current.map((box) =>
        lassoSelection.textBoxIds.has(box.id)
          ? { ...box, x: box.x + deltaX, y: box.y + deltaY }
          : box
      )
    );
  };

  const scaleLassoSelection = (factor: number) => {
    if (!lassoSelection || !lassoSelectionBounds || lassoSelectionCount === 0) return;

    recordHistory();
    const center = {
      x: (lassoSelectionBounds.minX + lassoSelectionBounds.maxX) / 2,
      y: (lassoSelectionBounds.minY + lassoSelectionBounds.maxY) / 2,
    };
    const scalePoint = (point: CanvasPoint): CanvasPoint => ({
      x: center.x + (point.x - center.x) * factor,
      y: center.y + (point.y - center.y) * factor,
    });

    setLines((current) =>
      current.map((line) =>
        lassoSelection.lineIds.has(line.id)
          ? { ...line, points: line.points.map(scalePoint) }
          : line
      )
    );
    setImages((current) =>
      current.map((image) => {
        if (!lassoSelection.imageIds.has(image.id)) return image;
        const topLeft = scalePoint({ x: image.x, y: image.y });
        return {
          ...image,
          x: topLeft.x,
          y: topLeft.y,
          width: Math.max(12, image.width * factor),
          height: Math.max(12, image.height * factor),
        };
      })
    );
    setTextBoxes((current) =>
      current.map((box) => {
        if (!lassoSelection.textBoxIds.has(box.id)) return box;
        const topLeft = scalePoint({ x: box.x, y: box.y });
        return {
          ...box,
          x: topLeft.x,
          y: topLeft.y,
          width: Math.max(48, (box.width ?? 170) * factor),
          height: Math.max(32, (box.height ?? 72) * factor),
        };
      })
    );
  };

  const deleteLassoSelection = () => {
    if (!lassoSelection || lassoSelectionCount === 0) return;

    recordHistory();
    const lineIds = Array.from(lassoSelection.lineIds);
    const imageIds = Array.from(lassoSelection.imageIds);
    const textBoxIds = Array.from(lassoSelection.textBoxIds);
    setLines((current) => current.filter((line) => !lassoSelection.lineIds.has(line.id)));
    setImages((current) => current.filter((image) => !lassoSelection.imageIds.has(image.id)));
    setTextBoxes((current) => current.filter((box) => !lassoSelection.textBoxIds.has(box.id)));
    setDeletedLineIds((current) => Array.from(new Set([...current, ...lineIds])));
    setDeletedImageIds((current) => Array.from(new Set([...current, ...imageIds])));
    setDeletedTextBoxIds((current) => Array.from(new Set([...current, ...textBoxIds])));
    setLassoSelection(null);
  };

  const addImage = async () => {
    const activeToken = tokenRef.current;
    if (!activeToken) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Flownote Canvas', '이미지를 추가하려면 사진 보관함 권한이 필요합니다.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;

    try {
      const asset = result.assets[0];
      const url = await flownoteApi.uploadCanvasImage(activeToken, {
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        file: asset.file,
      });
      const width = asset.width || 320;
      const height = asset.height || 240;
      const maxWidth = 360;
      const ratio = Math.min(1, maxWidth / width);
      recordHistory();
      setImages((current) => [
        ...current,
        {
          id: makeId('image'),
          url,
          x: viewportCenter.x - (width * ratio) / 2,
          y: viewportCenter.y - (height * ratio) / 2,
          width: width * ratio,
          height: height * ratio,
        },
      ]);
      setTool('handle');
    } catch (error) {
      Alert.alert('Flownote Canvas', error instanceof Error ? error.message : '이미지를 추가하지 못했습니다.');
    }
  };

  const addTextAt = (point: CanvasPoint) => {
    const box: CanvasTextBox = {
      id: makeId('text'),
      x: point.x,
      y: point.y,
      width: 170,
      height: 72,
      text: 'Text',
    };
    setTextBoxes((current) => [...current, box]);
    setSelectedTextId(box.id);
  };

  const beginInteraction = (event: GestureResponderEvent) => {
    const touches = getTouches(event);
    if (touches.length >= 2) {
      beginViewportGesture(touches);
      return;
    }

    if (suppressSingleTouchRef.current) {
      return;
    }

    const point = getPoint(event);

    if (tool === 'pen') {
      setLassoSelection(null);
      recordHistory();
      setCurrentLine((current) => appendDrawPoint(current.length > 0 ? current : [], point));
      return;
    }

    if (tool === 'eraser') {
      setLassoSelection(null);
      recordHistory();
      eraseAt(point);
      return;
    }

    if (tool === 'text') {
      setLassoSelection(null);
      recordHistory();
      addTextAt(point);
      return;
    }

    if (tool === 'lasso') {
      if (lassoSelection && isPointInsideBounds(point, lassoSelectionBounds)) {
        recordHistory();
        lassoDragStartRef.current = point;
        return;
      }
      setSelectedTextId(null);
      setLassoSelection(null);
      setCurrentLasso([point]);
      return;
    }

    const hitImage = [...images].reverse().find((image) => pointInImage(point, image));
    const hitText = [...textBoxes].reverse().find((box) => pointInTextBox(point, box));
    setSelectedTextId(hitText?.id ?? null);
    setLassoSelection(null);
    if (hitImage) {
      recordHistory();
      draggingImageRef.current = {
        id: hitImage.id,
        offsetX: point.x - hitImage.x,
        offsetY: point.y - hitImage.y,
      };
      return;
    }
    if (hitText) {
      recordHistory();
      draggingTextRef.current = {
        id: hitText.id,
        offsetX: point.x - hitText.x,
        offsetY: point.y - hitText.y,
      };
    }
  };

  const moveInteraction = (event: GestureResponderEvent) => {
    const touches = getTouches(event);
    if (touches.length >= 2) {
      if (!viewportGestureRef.current) {
        beginViewportGesture(touches);
      }
      updateViewportGesture(touches);
      return;
    }

    if (isViewportGestureRef.current || suppressSingleTouchRef.current) {
      return;
    }

    const point = getPoint(event);

    if (tool === 'pen' && currentLine.length > 0) {
      setCurrentLine((current) => appendDrawPoint(current, point));
      return;
    }

    if (tool === 'lasso') {
      if (lassoDragStartRef.current) {
        moveLassoSelection(point.x - lassoDragStartRef.current.x, point.y - lassoDragStartRef.current.y);
        lassoDragStartRef.current = point;
      } else if (currentLasso.length > 0) {
        setCurrentLasso((current) => [...current, point]);
      }
      return;
    }

    if (tool === 'eraser') {
      eraseAt(point);
      return;
    }

    if (tool === 'handle' && draggingImageRef.current) {
      const { id, offsetX, offsetY } = draggingImageRef.current;
      setImages((current) =>
        current.map((image) =>
          image.id === id
            ? {
                ...image,
                x: point.x - offsetX,
                y: point.y - offsetY,
              }
            : image
        )
      );
      return;
    }

    if (tool === 'handle' && draggingTextRef.current) {
      const { id, offsetX, offsetY } = draggingTextRef.current;
      setTextBoxes((current) =>
        current.map((box) =>
          box.id === id
            ? {
                ...box,
                x: point.x - offsetX,
                y: point.y - offsetY,
              }
            : box
        )
      );
    }
  };

  const endInteraction = (event: GestureResponderEvent) => {
    if (isViewportGestureRef.current || suppressSingleTouchRef.current) {
      const remainingTouches = getTouches(event).length;
      viewportGestureRef.current = null;
      draggingTextRef.current = null;
      draggingImageRef.current = null;
      lassoDragStartRef.current = null;
      setCurrentLine([]);
      setCurrentLasso([]);
      if (remainingTouches === 0) {
        isViewportGestureRef.current = false;
        suppressSingleTouchRef.current = false;
      }
      return;
    }

    if (tool === 'pen' && currentLine.length > 1) {
      const finishedLine = smoothLinePoints(currentLine);
      setLines((current) => [
        ...current,
        {
          id: makeId('line'),
          points: finishedLine,
          strokeWidth: 3,
          color: penColor,
        },
      ]);
    }
    if (tool === 'lasso' && currentLasso.length > 2) {
      const polygon = currentLasso;
      const nextSelection: LassoSelection = {
        lineIds: new Set(lines.filter((line) => lineHitsPolygon(line, polygon)).map((line) => line.id)),
        imageIds: new Set(images.filter((image) => {
          const center = { x: image.x + image.width / 2, y: image.y + image.height / 2 };
          return isPointInPolygon(center, polygon);
        }).map((image) => image.id)),
        textBoxIds: new Set(textBoxes.filter((box) => {
          const width = box.width ?? 170;
          const height = box.height ?? 72;
          const center = { x: box.x + width / 2, y: box.y + height / 2 };
          return isPointInPolygon(center, polygon);
        }).map((box) => box.id)),
      };
      setLassoSelection(selectionCount(nextSelection) > 0 ? nextSelection : null);
    }
    setCurrentLine([]);
    setCurrentLasso([]);
    draggingTextRef.current = null;
    draggingImageRef.current = null;
    lassoDragStartRef.current = null;
  };

  const updateSelectedText = () => {
    if (!selectedTextId) {
      return;
    }

    recordHistory();
    setTextBoxes((current) =>
      current.map((box) => (box.id === selectedTextId ? { ...box, text: draftText } : box))
    );
  };

  if (sessionLoading && !token) {
    return (
      <ThemedView style={styles.centeredScreen}>
        <ActivityIndicator color="#44403C" />
      </ThemedView>
    );
  }

  if (!token) {
    return (
      <ThemedView style={styles.centeredScreen}>
        <ThemedText type="subtitle" style={styles.title}>로그인이 필요합니다</ThemedText>
        <ThemedText style={styles.muted}>Account 탭에서 먼저 로그인하세요.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.toolbar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toolbarContent}>
          {(['pen', 'eraser', 'lasso', 'handle', 'text'] as Tool[]).map((item) => {
            const active = tool === item;
            const config = TOOL_CONFIG[item];

            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={`${config.label} 도구`}
                style={[styles.toolButton, active && styles.toolButtonActive]}
                onPress={() => setTool(item)}>
                <MaterialIcons
                  name={config.icon}
                  size={18}
                  color={active ? '#FFFBEB' : '#44403C'}
                />
                <ThemedText
                  type="defaultSemiBold"
                  style={active ? styles.toolTextActive : styles.toolText}>
                  {config.label}
                </ThemedText>
              </Pressable>
            );
          })}
          <View style={styles.colorGroup}>
            <ThemedText type="defaultSemiBold" style={styles.colorLabel}>색상</ThemedText>
            {PEN_COLORS.map((color) => (
              <Pressable
                key={color.value}
                accessibilityRole="button"
                accessibilityLabel={`펜 색상 ${color.label}`}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: color.value },
                  penColor === color.value && styles.colorSwatchActive,
                ]}
                onPress={() => selectPenColor(color.value)}
              />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="이미지 추가"
            style={styles.actionButton}
            onPress={() => void addImage()}>
            <MaterialIcons name="add-photo-alternate" size={18} color="#FFFBEB" />
            <ThemedText type="defaultSemiBold" style={styles.actionText}>이미지</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="올가미 선택 축소"
            style={[styles.actionButton, lassoSelectionCount === 0 && styles.disabledButton]}
            onPress={() => scaleLassoSelection(0.88)}
            disabled={lassoSelectionCount === 0}>
            <MaterialIcons name="zoom-out" size={18} color="#FFFBEB" />
            <ThemedText type="defaultSemiBold" style={styles.actionText}>축소</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="올가미 선택 확대"
            style={[styles.actionButton, lassoSelectionCount === 0 && styles.disabledButton]}
            onPress={() => scaleLassoSelection(1.12)}
            disabled={lassoSelectionCount === 0}>
            <MaterialIcons name="zoom-in" size={18} color="#FFFBEB" />
            <ThemedText type="defaultSemiBold" style={styles.actionText}>확대</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="올가미 선택 삭제"
            style={[styles.dangerActionButton, lassoSelectionCount === 0 && styles.disabledButton]}
            onPress={deleteLassoSelection}
            disabled={lassoSelectionCount === 0}>
            <MaterialIcons name="delete-sweep" size={18} color="#FFFBEB" />
            <ThemedText type="defaultSemiBold" style={styles.actionText}>선택 {lassoSelectionCount}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="실행 취소"
            style={[styles.actionButton, historyRef.current.length === 0 && styles.disabledButton]}
            onPress={undo}
            disabled={historyRef.current.length === 0}>
            <MaterialIcons name="undo" size={18} color="#FFFBEB" />
            <ThemedText type="defaultSemiBold" style={styles.actionText}>실행 취소</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="캔버스 불러오기"
            style={[styles.actionButton, loading && styles.disabledButton]}
            onPress={load}
            disabled={loading}>
            <MaterialIcons name="file-download" size={18} color="#FFFBEB" />
            <ThemedText type="defaultSemiBold" style={styles.actionText}>불러오기</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="캔버스 저장"
            style={[styles.actionButton, saving && styles.disabledButton]}
            onPress={() => void save()}
            disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <MaterialIcons name="save" size={18} color="#FFFBEB" />
            )}
            <ThemedText type="defaultSemiBold" style={styles.actionText}>저장</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="캔버스 화면 초기화"
            style={styles.actionButton}
            onPress={resetViewport}>
            <MaterialIcons name="center-focus-strong" size={18} color="#FFFBEB" />
            <ThemedText type="defaultSemiBold" style={styles.actionText}>화면</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={libraryVisible ? '캔버스 폴더 숨기기' : '캔버스 폴더 표시'}
            style={styles.actionButton}
            onPress={toggleLibraryVisible}>
            <MaterialIcons name={libraryVisible ? 'folder-open' : 'folder'} size={18} color="#FFFBEB" />
            <ThemedText type="defaultSemiBold" style={styles.actionText}>폴더</ThemedText>
          </Pressable>
        </ScrollView>
      </View>

      {libraryVisible ? (
        <View style={styles.libraryPanel}>
          <View style={styles.libraryHeader}>
            <ThemedText type="subtitle" style={styles.libraryTitle}>캔버스 폴더</ThemedText>
            <Pressable style={styles.libraryIconButton} onPress={() => void createCanvas()}>
              <MaterialIcons name="add" size={20} color="#FFFBEB" />
            </Pressable>
          </View>
          <View style={styles.folderForm}>
            <TextInput
              style={styles.folderInput}
              value={folderCategory}
              onChangeText={setFolderCategory}
              placeholder="카테고리"
              placeholderTextColor="#A8A29E"
            />
            <TextInput
              style={styles.folderInput}
              value={folderName}
              onChangeText={setFolderName}
              placeholder="폴더 이름"
              placeholderTextColor="#A8A29E"
            />
            <Pressable
              style={[styles.libraryIconButton, !folderName.trim() && styles.disabledButton]}
              onPress={() => void createFolder()}
              disabled={!folderName.trim()}>
              <MaterialIcons name="create-new-folder" size={20} color="#FFFBEB" />
            </Pressable>
          </View>
          {libraryError ? <ThemedText style={styles.libraryError}>{libraryError}</ThemedText> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.libraryList}>
            {Object.entries(canvasFoldersByCategory).map(([category, folders]) => (
              <View key={category} style={styles.folderColumn}>
                <ThemedText type="defaultSemiBold" style={styles.folderCategory}>{category}</ThemedText>
                {folders.map((folder) => {
                  const folderCanvasIds = new Set(folder.canvasIds);
                  const folderCanvases = canvasDocuments.filter((document) => folderCanvasIds.has(document.id));
                  const isCollapsed = collapsedFolderIds.has(folder.id);
                  return (
                    <View key={folder.id} style={styles.folderCard}>
                      <View style={styles.folderCardHeader}>
                        {editingFolderId === folder.id ? (
                          <View style={styles.inlineEditGroup}>
                            <TextInput
                              style={styles.inlineInput}
                              value={editingFolderCategory}
                              onChangeText={setEditingFolderCategory}
                              placeholder="카테고리"
                              placeholderTextColor="#A8A29E"
                            />
                            <TextInput
                              style={styles.inlineInput}
                              value={editingFolderName}
                              onChangeText={setEditingFolderName}
                              placeholder="폴더 이름"
                              placeholderTextColor="#A8A29E"
                            />
                          </View>
                        ) : (
                          <>
                            <Pressable style={styles.smallIconButton} onPress={() => toggleFolderCollapsed(folder.id)}>
                              <MaterialIcons name={isCollapsed ? 'chevron-right' : 'expand-more'} size={17} color="#44403C" />
                            </Pressable>
                            <MaterialIcons name="folder" size={18} color="#D97706" />
                            <ThemedText numberOfLines={1} type="defaultSemiBold" style={styles.folderName}>{folder.name}</ThemedText>
                            <View style={styles.folderCountBadge}>
                              <ThemedText type="defaultSemiBold" style={styles.folderCountText}>{folderCanvases.length}</ThemedText>
                            </View>
                          </>
                        )}
                        {editingFolderId === folder.id ? (
                          <>
                            <Pressable style={styles.smallIconButton} onPress={() => void updateFolder()}>
                              <MaterialIcons name="check" size={16} color="#44403C" />
                            </Pressable>
                            <Pressable style={styles.smallIconButton} onPress={() => setEditingFolderId(null)}>
                              <MaterialIcons name="close" size={16} color="#44403C" />
                            </Pressable>
                          </>
                        ) : (
                          <>
                            <Pressable style={styles.smallIconButton} onPress={() => beginEditFolder(folder)}>
                              <MaterialIcons name="edit" size={16} color="#44403C" />
                            </Pressable>
                            <Pressable style={styles.smallIconButton} onPress={() => void deleteFolder(folder.id)}>
                              <MaterialIcons name="delete-outline" size={16} color="#B91C1C" />
                            </Pressable>
                          </>
                        )}
                        <Pressable style={styles.smallIconButton} onPress={() => void createCanvas(folder.id)}>
                          <MaterialIcons name="add" size={16} color="#44403C" />
                        </Pressable>
                      </View>
                      {isCollapsed ? null : folderCanvases.length > 0 ? folderCanvases.map((document) => (
                        <View key={document.id} style={[styles.canvasChip, selectedCanvasId === document.id && styles.canvasChipActive]}>
                          {editingCanvasId === document.id ? (
                            <TextInput
                              style={[styles.inlineInput, styles.canvasTitleInput]}
                              value={editingCanvasTitle}
                              onChangeText={setEditingCanvasTitle}
                              placeholder="캔버스 이름"
                              placeholderTextColor="#A8A29E"
                            />
                          ) : (
                            <Pressable style={styles.canvasChipMain} onPress={() => selectCanvas(document.id)}>
                              <ThemedText
                                numberOfLines={1}
                                type="defaultSemiBold"
                                style={selectedCanvasId === document.id ? styles.canvasChipTextActive : styles.canvasChipText}>
                                {document.title}
                              </ThemedText>
                            </Pressable>
                          )}
                          {editingCanvasId === document.id ? (
                            <>
                              <Pressable style={styles.chipIconButton} onPress={() => void updateCanvasTitle()}>
                                <MaterialIcons name="check" size={15} color={selectedCanvasId === document.id ? '#FFFBEB' : '#44403C'} />
                              </Pressable>
                              <Pressable style={styles.chipIconButton} onPress={() => setEditingCanvasId(null)}>
                                <MaterialIcons name="close" size={15} color={selectedCanvasId === document.id ? '#FFFBEB' : '#44403C'} />
                              </Pressable>
                            </>
                          ) : (
                            <>
                              <Pressable style={styles.chipIconButton} onPress={() => beginEditCanvas(document)}>
                                <MaterialIcons name="edit" size={15} color={selectedCanvasId === document.id ? '#FFFBEB' : '#44403C'} />
                              </Pressable>
                              <Pressable style={styles.chipIconButton} onPress={() => void moveCanvasToFolder(document.id, null)}>
                                <MaterialIcons name="drive-file-move-outline" size={15} color={selectedCanvasId === document.id ? '#FFFBEB' : '#44403C'} />
                              </Pressable>
                              <Pressable style={styles.chipIconButton} onPress={() => void deleteCanvas(document.id)}>
                                <MaterialIcons name="delete-outline" size={15} color={selectedCanvasId === document.id ? '#FECACA' : '#B91C1C'} />
                              </Pressable>
                            </>
                          )}
                          {renderMoveTargets(document, folder.id)}
                        </View>
                      )) : (
                        <ThemedText style={styles.emptyFolderText}>캔버스 없음</ThemedText>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
            <View style={styles.folderColumn}>
              <ThemedText type="defaultSemiBold" style={styles.folderCategory}>최근 캔버스</ThemedText>
              <View style={styles.folderCard}>
                {unfiledCanvases.length > 0 ? unfiledCanvases.map((document) => (
                  <View
                    key={document.id}
                    style={[styles.canvasChip, selectedCanvasId === document.id && styles.canvasChipActive]}>
                    {editingCanvasId === document.id ? (
                      <TextInput
                        style={[styles.inlineInput, styles.canvasTitleInput]}
                        value={editingCanvasTitle}
                        onChangeText={setEditingCanvasTitle}
                        placeholder="캔버스 이름"
                        placeholderTextColor="#A8A29E"
                      />
                    ) : (
                      <Pressable style={styles.canvasChipMain} onPress={() => selectCanvas(document.id)}>
                        <ThemedText
                          numberOfLines={1}
                          type="defaultSemiBold"
                          style={selectedCanvasId === document.id ? styles.canvasChipTextActive : styles.canvasChipText}>
                          {document.title}
                        </ThemedText>
                      </Pressable>
                    )}
                    {editingCanvasId === document.id ? (
                      <>
                        <Pressable style={styles.chipIconButton} onPress={() => void updateCanvasTitle()}>
                          <MaterialIcons name="check" size={15} color={selectedCanvasId === document.id ? '#FFFBEB' : '#44403C'} />
                        </Pressable>
                        <Pressable style={styles.chipIconButton} onPress={() => setEditingCanvasId(null)}>
                          <MaterialIcons name="close" size={15} color={selectedCanvasId === document.id ? '#FFFBEB' : '#44403C'} />
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Pressable style={styles.chipIconButton} onPress={() => beginEditCanvas(document)}>
                          <MaterialIcons name="edit" size={15} color={selectedCanvasId === document.id ? '#FFFBEB' : '#44403C'} />
                        </Pressable>
                        <Pressable style={styles.chipIconButton} onPress={() => void deleteCanvas(document.id)}>
                          <MaterialIcons name="delete-outline" size={15} color={selectedCanvasId === document.id ? '#FECACA' : '#B91C1C'} />
                        </Pressable>
                      </>
                    )}
                    {renderMoveTargets(document, null)}
                  </View>
                )) : (
                  <ThemedText style={styles.emptyFolderText}>폴더 밖 캔버스가 없습니다</ThemedText>
                )}
              </View>
            </View>
          </ScrollView>
        </View>
      ) : null}

      <View
        style={styles.canvasBoard}
        onLayout={updateBoardSize}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={beginInteraction}
        onResponderMove={moveInteraction}
        onResponderRelease={endInteraction}
        onResponderTerminate={endInteraction}
        onResponderTerminationRequest={() => false}>
        <Svg style={styles.svgLayer}>
          <G transform={viewportTransform}>
            {Array.from({ length: 16 }).map((_, index) => (
              <Polyline
                key={`grid-x-${index}`}
                points={`${index * 120},0 ${index * 120},1800`}
                fill="none"
                stroke="#F5F5F4"
                strokeWidth={1}
              />
            ))}
            {Array.from({ length: 16 }).map((_, index) => (
              <Polyline
                key={`grid-y-${index}`}
                points={`0,${index * 120} 1800,${index * 120}`}
                fill="none"
                stroke="#F5F5F4"
                strokeWidth={1}
              />
            ))}
          </G>
          <G transform={viewportTransform}>
            {images.map((image) => (
              <G key={image.id}>
                <SvgImage
                  href={image.url}
                  x={image.x}
                  y={image.y}
                  width={image.width}
                  height={image.height}
                  preserveAspectRatio="xMidYMid slice"
                />
                {lassoSelection?.imageIds.has(image.id) ? (
                  <Rect
                    x={image.x}
                    y={image.y}
                    width={image.width}
                    height={image.height}
                    fill="none"
                    stroke="#2563EB"
                    strokeDasharray="8 5"
                    strokeWidth={2}
                  />
                ) : null}
              </G>
            ))}
            {lines.map((line) => (
              <Path
                key={line.id}
                d={lineToSmoothPath(line.points)}
                fill="none"
                stroke={line.color ?? '#1F2937'}
                strokeWidth={line.strokeWidth ?? 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={lassoSelection?.lineIds.has(line.id) ? 0.72 : 1}
              />
            ))}
            {currentLine.length > 1 ? (
              <Path
                d={lineToSmoothPath(currentLine)}
                fill="none"
                stroke={penColor}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {currentLasso.length > 1 ? (
              <Path
                d={lineToSmoothPath(currentLasso)}
                fill="none"
                stroke="#2563EB"
                strokeWidth={2}
                strokeDasharray="10 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {textBoxes.map((box) => (
              <G key={box.id}>
                <Rect
                  x={box.x}
                  y={box.y}
                  width={box.width ?? 170}
                  height={box.height ?? 72}
                  rx={8}
                  fill="#FEF3C7"
                  stroke={box.id === selectedTextId || lassoSelection?.textBoxIds.has(box.id) ? '#92400E' : '#D97706'}
                  strokeWidth={box.id === selectedTextId || lassoSelection?.textBoxIds.has(box.id) ? 2 : 1}
                />
                <SvgText x={box.x + 12} y={box.y + 28} fill="#17212B" fontSize={15} fontWeight="700">
                  {splitTextLines(box.text).slice(0, 3).map((line, index) => (
                    <TSpan key={`${box.id}-${index}`} x={box.x + 12} dy={index === 0 ? 0 : 20}>
                      {line}
                    </TSpan>
                  ))}
                </SvgText>
              </G>
            ))}
            {lassoSelectionBounds ? (
              <Rect
                x={lassoSelectionBounds.minX}
                y={lassoSelectionBounds.minY}
                width={Math.max(1, lassoSelectionBounds.maxX - lassoSelectionBounds.minX)}
                height={Math.max(1, lassoSelectionBounds.maxY - lassoSelectionBounds.minY)}
                fill="#DBEAFE"
                fillOpacity={0.35}
                stroke="#2563EB"
                strokeDasharray="8 6"
                strokeWidth={2}
              />
            ) : null}
          </G>
          {tool === 'eraser' ? <Circle cx={28} cy={28} r={12} fill="none" stroke="#DC2626" /> : null}
        </Svg>
        <View style={[styles.canvasHud, styles.pointerNone]}>
          <ThemedText type="defaultSemiBold" style={styles.hudText}>
            {TOOL_CONFIG[tool].label} · 확대 {Math.round(viewport.scale * 100)}% · 중심 X {Math.round(viewportCenter.x)}, Y {Math.round(viewportCenter.y)} · 요소 {lines.length + images.length + textBoxes.length}
          </ThemedText>
        </View>
        {loading ? (
          <View style={[styles.loadingOverlay, styles.pointerNone]}>
            <ActivityIndicator color="#44403C" />
          </View>
        ) : null}
      </View>

      {selectedTextBox ? (
        <View style={styles.editorPanel}>
          <ThemedText type="defaultSemiBold" style={styles.title}>선택한 텍스트</ThemedText>
          <TextInput
            multiline
            style={styles.textEditor}
            value={draftText}
            onChangeText={setDraftText}
            onEndEditing={updateSelectedText}
          />
          <Pressable style={styles.actionButton} onPress={updateSelectedText}>
            <ThemedText type="defaultSemiBold" style={styles.actionText}>텍스트 반영</ThemedText>
          </Pressable>
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  centeredScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  toolbar: {
    borderBottomWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FEF3C7',
    padding: 10,
  },
  toolbarContent: {
    gap: 8,
    paddingRight: 10,
  },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
  toolButtonActive: {
    backgroundColor: '#44403C',
  },
  toolText: {
    color: '#44403C',
  },
  toolTextActive: {
    color: '#FFFBEB',
  },
  colorGroup: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
  },
  colorLabel: {
    color: '#44403C',
    fontSize: 12,
  },
  colorSwatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  colorSwatchActive: {
    borderColor: '#44403C',
  },
  actionButton: {
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#44403C',
    paddingHorizontal: 12,
  },
  dangerActionButton: {
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#B91C1C',
    paddingHorizontal: 12,
  },
  actionText: {
    color: '#FFFBEB',
  },
  disabledButton: {
    opacity: 0.45,
  },
  libraryPanel: {
    gap: 8,
    borderBottomWidth: 1,
    borderColor: '#E7E5E4',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  libraryHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  libraryTitle: {
    color: '#292524',
  },
  libraryIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#44403C',
  },
  folderForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  folderInput: {
    minHeight: 38,
    minWidth: 112,
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6D3D1',
    backgroundColor: '#FFFFFF',
    color: '#292524',
    paddingHorizontal: 10,
  },
  libraryError: {
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    color: '#B91C1C',
    padding: 8,
  },
  libraryList: {
    gap: 10,
    paddingRight: 10,
  },
  folderColumn: {
    width: 220,
    gap: 6,
  },
  folderCategory: {
    color: '#78716C',
    fontSize: 12,
  },
  folderCard: {
    gap: 7,
    minHeight: 84,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E7E5E4',
    backgroundColor: '#FFFFFF',
    padding: 8,
  },
  folderCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  folderName: {
    flex: 1,
    color: '#292524',
  },
  folderCountBadge: {
    minWidth: 24,
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#F5F5F4',
    paddingHorizontal: 6,
  },
  folderCountText: {
    color: '#78716C',
    fontSize: 11,
  },
  inlineEditGroup: {
    flex: 1,
    gap: 5,
  },
  inlineInput: {
    minHeight: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D6D3D1',
    backgroundColor: '#FFFFFF',
    color: '#292524',
    paddingHorizontal: 8,
    fontSize: 12,
  },
  smallIconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#F5F5F4',
  },
  canvasChip: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#E7E5E4',
    backgroundColor: '#FAFAF9',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  canvasChipActive: {
    borderColor: '#D97706',
    backgroundColor: '#44403C',
  },
  canvasChipMain: {
    minHeight: 28,
    flex: 1,
    justifyContent: 'center',
  },
  canvasTitleInput: {
    flex: 1,
    minWidth: 96,
  },
  chipIconButton: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  canvasChipText: {
    color: '#44403C',
    fontSize: 12,
  },
  canvasChipTextActive: {
    color: '#FFFBEB',
    fontSize: 12,
  },
  emptyFolderText: {
    color: '#A8A29E',
    fontSize: 12,
  },
  moveTargetScroller: {
    maxWidth: 108,
  },
  moveTargetButton: {
    maxWidth: 88,
    minHeight: 24,
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#FEF3C7',
    marginLeft: 4,
    paddingHorizontal: 7,
  },
  moveTargetText: {
    color: '#92400E',
    fontSize: 11,
    fontWeight: '700',
  },
  canvasBoard: {
    flex: 1,
    minHeight: 520,
    backgroundColor: '#FFFFFF',
  },
  svgLayer: {
    flex: 1,
  },
  editorPanel: {
    gap: 10,
    borderTopWidth: 1,
    borderColor: '#E7E5E4',
    backgroundColor: '#F8FAFC',
    padding: 12,
  },
  textEditor: {
    minHeight: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6D3D1',
    backgroundColor: '#FFFFFF',
    color: '#17212B',
    padding: 10,
    textAlignVertical: 'top',
  },
  title: {
    color: '#143241',
  },
  muted: {
    color: '#5C6670',
  },
  canvasHud: {
    position: 'absolute',
    top: 12,
    right: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(68, 64, 60, 0.86)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hudText: {
    color: '#FFFBEB',
    fontSize: 12,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
  },
  pointerNone: {
    pointerEvents: 'none',
  },
});
