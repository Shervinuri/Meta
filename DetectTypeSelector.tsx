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

// Fix: Import React to provide JSX type definitions.
import {useAtom} from 'jotai';
import React from 'react';
import {DetectTypeAtom, HoverEnteredAtom} from './atoms';
import {DetectTypes} from './Types';

export function DetectTypeSelector() {
  return (
    <div className="flex flex-col flex-shrink-0">
      <div className="mb-3 uppercase">Give me:</div>
      <div className="flex flex-col gap-3">
        {['2D bounding boxes', 'Segmentation masks', 'Points'].map((label) => (
          <SelectOption key={label} label={label} />
        ))}
      </div>
    </div>
  );
}

// Fix: Changed component to a function declaration.
// This helps TypeScript correctly infer that this is a React component
// that can accept a `key` prop.
function SelectOption({label}: {label: string}) {
  const [detectType, setDetectType] = useAtom(DetectTypeAtom);
  const [, setHoverEntered] = useAtom(HoverEnteredAtom);

  return (
    <button
      className={`py-6 items-center bg-transparent text-center gap-3`}
      style={{
        borderColor: detectType === label ? 'var(--accent-color)' : undefined,
        backgroundColor:
          detectType === label ? 'var(--border-color)' : undefined,
      }}
      onClick={() => {
        setHoverEntered(false);
        setDetectType(label as DetectTypes);
      }}>
      {label}
    </button>
  );
}
