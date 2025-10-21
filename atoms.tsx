/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Copyright 2025 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {atom} from 'jotai';
// FIX: Add missing imports
import {BoundingBox2DType, DetectTypes} from './Types';
import {colors, defaultPromptParts} from './consts';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'closed';
export const ConnectionStateAtom = atom<ConnectionState>('idle');

export interface Transcript {
  source: 'user' | 'model';
  text: string;
  isFinal: boolean;
}
export const TranscriptsAtom = atom<Transcript[]>([]);

export const BoundingBoxesAtom = atom<BoundingBox2DType[]>([]);

// FIX: Add missing atom exports
export const BoundingBoxes2DAtom = atom<BoundingBox2DType[]>([]);

export const BoundingBoxMasksAtom = atom<
  {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    imageData: string;
  }[]
>([]);

export const PointsAtom = atom<{point: {x: number; y: number}; label: string}[]>(
  [],
);

export const DetectTypeAtom = atom<DetectTypes>('2D bounding boxes');

export const DrawModeAtom = atom(false);

export const ImageSentAtom = atom(false);

export const ImageSrcAtom = atom<string | null>(null);

export const LinesAtom = atom<[[number, number][], string][]>([]);

export const RevealOnHoverModeAtom = atom(true);

export const ActiveColorAtom = atom(colors[0]);

export const HoverEnteredAtom = atom(false);

export const IsUploadedImageAtom = atom(false);

export const IsLoadingAtom = atom(false);

export const IsThinkingEnabledAtom = atom(true);

export const PromptsAtom = atom<{ [key in DetectTypes]?: string[] }>(
  defaultPromptParts
);

export const RequestJsonAtom = atom('');

export const ResponseJsonAtom = atom('');

export const SelectedModelAtom = atom('gemini-2.5-flash');

export const TemperatureAtom = atom(0.4);

export const BumpSessionAtom = atom(0);

export const ApiKeyAtom = atom<string | null>(null);
