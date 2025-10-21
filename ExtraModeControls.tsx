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

import {useAtom} from 'jotai';
import React from 'react';
import {DrawModeAtom, LinesAtom} from './atoms';
import {Palette} from './Palette';

export function ExtraModeControls() {
  const [drawMode, setDrawMode] = useAtom(DrawModeAtom);
  const [, setLines] = useAtom(LinesAtom);

  return (
    <>
      {drawMode ? (
        <div className="flex gap-3 px-3 py-3 items-center justify-between border-t">
          <div style={{width: 200}}></div>
          <div className="grow flex justify-center">
            <Palette />
          </div>
          <div className="flex gap-3">
            <div className="flex gap-3">
              <button
                className="flex gap-3 text-sm secondary"
                onClick={() => {
                  setLines([]);
                }}>
                <div className="text-xs">🗑️</div>
                Clear
              </button>
            </div>
            <div className="flex gap-3">
              <button
                className="flex gap-3 secondary"
                onClick={() => {
                  setDrawMode(false);
                }}>
                <div className="text-sm">✅</div>
                <div>Done</div>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
