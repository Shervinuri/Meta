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
import React, {useState} from 'react';
import {ApiKeyAtom} from './atoms';

export function ApiKeyModal() {
  const [key, setKey] = useState('');
  // FIX: `useSetAtom` was causing a type error. Switched to `useAtom` to get the setter, which works correctly with primitive atoms.
  const [, setApiKey] = useAtom(ApiKeyAtom);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) {
      localStorage.setItem('gemini_api_key', key.trim());
      setApiKey(key.trim());
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
      <div className="bg-[#1C1F21] p-8 rounded-lg shadow-xl w-full max-w-md border border-[#37393c]">
        <h2 className="text-2xl font-bold text-center mb-4">
          Enter Your Gemini API Key
        </h2>
        <p className="text-center text-gray-400 mb-6">
          You need an API key to use this application. You can get one from the
          Google AI Studio.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Enter your API key here"
            className="w-full px-4 py-3 bg-[#2a2d30] border border-[#37393c] rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Gemini API Key"
          />
          <a
            href="https://ai.google.dev/"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-sm text-blue-400 hover:underline mt-3">
            Get an API Key from Google AI Studio
          </a>
          <button
            type="submit"
            disabled={!key.trim()}
            className="w-full mt-6 py-3 bg-blue-600 text-white font-bold rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed">
            Save and Continue
          </button>
        </form>
      </div>
    </div>
  );
}
