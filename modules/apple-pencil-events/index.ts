import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

import type { PencilAction } from '@/lib/apple-pencil-bridge';

type ApplePencilEvents = {
  onDoubleTap: (event: { action: PencilAction }) => void;
};

declare class ApplePencilEventsModule extends NativeModule<ApplePencilEvents> {}

const nativeModule = requireOptionalNativeModule<ApplePencilEventsModule>('ApplePencilEvents');

export const addApplePencilDoubleTapListener = (listener: ApplePencilEvents['onDoubleTap']) => (
  nativeModule?.addListener('onDoubleTap', listener) ?? { remove() {} }
);
