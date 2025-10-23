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

import {GoogleGenAI} from '@google/genai';
import {useAtom} from 'jotai';
import getStroke from 'perfect-freehand';
import React, {useState} from 'react';
import {
  BoundingBoxMasksAtom,
  BoundingBoxes2DAtom,
  DetectTypeAtom,
  HoverEnteredAtom,
  ImageSrcAtom,
  IsLoadingAtom,
  IsThinkingEnabledAtom,
  LinesAtom,
  PointsAtom,
  PromptsAtom,
  RequestJsonAtom,
  ResponseJsonAtom,
  SelectedModelAtom,
  TemperatureAtom,
} from './atoms';
import {lineOptions} from './consts';
import {DetectTypes} from './Types';
import {getSvgPathFromStroke, loadImage} from './utils';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});
export function Prompt() {
  const [temperature, setTemperature] = useAtom(TemperatureAtom);
  const [, setBoundingBoxes2D] = useAtom(BoundingBoxes2DAtom);
  const [, setBoundingBoxMasks] = useAtom(BoundingBoxMasksAtom);
  const [detectType] = useAtom(DetectTypeAtom);
  const [, setPoints] = useAtom(PointsAtom);
  const [, setHoverEntered] = useAtom(HoverEnteredAtom);
  const [lines] = useAtom(LinesAtom);
  const [imageSrc] = useAtom(ImageSrcAtom);
  const [targetPrompt, setTargetPrompt] = useState('items');
  const [selectedModel, setSelectedModel] = useAtom(SelectedModelAtom);
  const [isThinkingEnabled, setIsThinkingEnabled] = useAtom(
    IsThinkingEnabledAtom,
  );

  const [prompts, setPrompts] = useAtom(PromptsAtom);
  const [isLoading, setIsLoading] = useAtom(IsLoadingAtom);
  const [, setRequestJson] = useAtom(RequestJsonAtom);
  const [, setResponseJson] = useAtom(ResponseJsonAtom);
  const [responseTime, setResponseTime] = useState<string | null>(null);

  const is2d = detectType === '2D bounding boxes';

  const currentModel = selectedModel;

  const get2dPrompt = () =>
    `Detect ${targetPrompt}, with no more than 20 items. Output a json list where each entry contains the 2D bounding box in "box_2d" and a text label in "label".`;

  const getGenericPrompt = (type: DetectTypes) => {
    if (!prompts[type] || prompts[type]!.length < 3)
      return prompts[type]?.join(' ') || '';
    const [p0, p1, p2] = prompts[type]!;
    return `${p0} ${p1}${p2}`;
  };

  async function handleSend() {
    setIsLoading(true);
    setRequestJson('');
    setResponseJson('');
    setResponseTime(null);
    const startTime = performance.now();
    try {
      let activeDataURL;
      const maxSize = 640;
      const copyCanvas = document.createElement('canvas');
      const ctx = copyCanvas.getContext('2d')!;

      if (imageSrc) {
        const image = await loadImage(imageSrc);
        const scale = Math.min(maxSize / image.width, maxSize / image.height);
        copyCanvas.width = image.width * scale;
        copyCanvas.height = image.height * scale;
        ctx.drawImage(image, 0, 0, image.width * scale, image.height * scale);
      } else {
        // Should not happen with disabled button, but we'll see
        setIsLoading(false);
        return;
      }
      activeDataURL = copyCanvas.toDataURL('image/png');

      if (lines.length > 0) {
        for (const line of lines) {
          const p = new Path2D(
            getSvgPathFromStroke(
              getStroke(
                line[0].map(([x, y]) => [
                  x * copyCanvas.width,
                  y * copyCanvas.height,
                  0.5,
                ]),
                lineOptions,
              ),
            ),
          );
          ctx.fillStyle = line[1];
          ctx.fill(p);
        }
        activeDataURL = copyCanvas.toDataURL('image/png');
      }

      setHoverEntered(false);
      const config: {
        temperature: number;
        thinkingConfig?: {thinkingBudget: number};
        responseMimeType?: string;
      } = {
        temperature,
        responseMimeType: 'application/json',
      };

      const model = currentModel;

      let setThinkingBudgetZero = !isThinkingEnabled;

      if (setThinkingBudgetZero) {
        config.thinkingConfig = {thinkingBudget: 0};
      }

      let textPromptToSend = '';
      if (is2d) {
        textPromptToSend = get2dPrompt();
      } else {
        textPromptToSend = getGenericPrompt(detectType);
      }

      const requestPayload = {
        model,
        contents: {
          parts: [
            {
              inlineData: {
                data: activeDataURL.replace('data:image/png;base64,', ''),
                mimeType: 'image/png',
              },
            },
            {text: textPromptToSend},
          ],
        },
        config,
      };

      const displayPayload = JSON.parse(JSON.stringify(requestPayload));
      displayPayload.contents.parts[0].inlineData.data =
        '<BASE64_IMAGE_DATA_REDACTED>';
      setRequestJson(JSON.stringify(displayPayload, null, 2));

      const genAIResponse = await ai.models.generateContent(requestPayload);

      let response = genAIResponse.text;

      if (response.includes('```json')) {
        response = response.split('```json')[1].split('```')[0];
      }
      try {
        const parsed = JSON.parse(response);
        setResponseJson(JSON.stringify(parsed, null, 2));
      } catch (e) {
        setResponseJson(response);
      }
      const parsedResponse = JSON.parse(response);
      if (detectType === '2D bounding boxes') {
        const formattedBoxes = parsedResponse.map(
          (box: {box_2d: [number, number, number, number]; label: string}) => {
            const [ymin, xmin, ymax, xmax] = box.box_2d;
            return {
              x: xmin / 1000,
              y: ymin / 1000,
              width: (xmax - xmin) / 1000,
              height: (ymax - ymin) / 1000,
              label: box.label,
            };
          },
        );
        setHoverEntered(false);
        setBoundingBoxes2D(formattedBoxes);
      } else if (detectType === 'Points') {
        const formattedPoints = parsedResponse.map(
          (point: {point: [number, number]; label: string}) => {
            return {
              point: {
                x: point.point[1] / 1000,
                y: point.point[0] / 1000,
              },
              label: point.label,
            };
          },
        );
        setPoints(formattedPoints);
      } else if (detectType === 'Segmentation masks') {
        const formattedBoxes = parsedResponse.map(
          (box: {
            box_2d: [number, number, number, number];
            label: string;
            mask: string;
          }) => {
            const [ymin, xmin, ymax, xmax] = box.box_2d;
            return {
              x: xmin / 1000,
              y: ymin / 1000,
              width: (xmax - xmin) / 1000,
              height: (ymax - ymin) / 1000,
              label: box.label,
              imageData: box.mask,
            };
          },
        );
        setHoverEntered(false);
        // sort largest to smallest
        const sortedBoxes = formattedBoxes.sort(
          (a: any, b: any) => b.width * b.height - a.width * a.height,
        );
        setBoundingBoxMasks(sortedBoxes);
      }
    } catch (error: any) {
      console.error('Error processing request:', error);
      setResponseJson(
        JSON.stringify(
          {
            error: 'An error occurred processing the response.',
            details: error.message,
          },
          null,
          2,
        ),
      );
      alert(
        `An error occurred. Please try again.\n\nDetails: ${error.message}`,
      );
    } finally {
      const endTime = performance.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      setResponseTime(`Response time: ${duration}s`);
      setIsLoading(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex grow flex-col gap-3">
      <div className="flex justify-between items-center">
        <div className="uppercase flex items-center gap-2">
          Model:
          <select
            value={currentModel}
            onChange={(e) => {
              setSelectedModel(e.target.value);
            }}
            disabled={isLoading}
            className="bg-[var(--input-color)] border border-[var(--border-color)] rounded-md p-1 text-sm normal-case font-mono">
            {/* FIX: Use gemini-2.5-pro instead of deprecated gemini-1.5-pro */}
            <option value="gemini-2.5-pro">
              gemini-2.5-pro
            </option>
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <label className="flex items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={isThinkingEnabled}
            onChange={(e) => setIsThinkingEnabled(e.target.checked)}
            disabled={isLoading}
          />
          Enable thinking
        </label>
        <div className="text-xs pl-6 text-[var(--text-color-secondary)]">
          Thinking improves the capabilities of the model to reason through
          tasks, but may produce less desirable results for simple locating
          tasks. For simple tasks, disable thinking for improved speed and
          likely better results.
        </div>
      </div>

      <div className="border-b my-1 border-[var(--border-color)]"></div>

      <div className="uppercase">Prompt</div>

      <div className="w-full flex flex-col">
        {is2d ? (
          <div className="flex flex-col gap-2">
            <div>Detect items:</div>
            <textarea
              className="w-full bg-[var(--input-color)] rounded-lg resize-none p-4"
              placeholder="e.g., cars, trees"
              rows={1}
              value={targetPrompt}
              onChange={(e) => setTargetPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
          </div>
        ) : detectType === 'Segmentation masks' ? (
          <div className="flex flex-col gap-2">
            <div>{prompts[detectType]?.[0]}</div>
            <textarea
              className="w-full bg-[var(--input-color)] rounded-lg resize-none p-4"
              placeholder="What to segment?"
              rows={1}
              value={prompts[detectType]?.[1]}
              onChange={(e) => {
                const value = e.target.value;
                const newPromptsState = {...prompts};
                if (!newPromptsState[detectType])
                  newPromptsState[detectType] = ['', '', ''];
                newPromptsState[detectType]![1] = value;
                setPrompts(newPromptsState);
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div>{prompts[detectType]?.[0]}</div>
            <textarea
              className="w-full bg-[var(--input-color)] rounded-lg resize-none p-4"
              placeholder="What kind of things do you want to detect?"
              rows={1}
              value={prompts[detectType]?.[1] ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                const newPromptsState = {...prompts};
                if (!newPromptsState[detectType])
                  newPromptsState[detectType] = ['', '', ''];
                newPromptsState[detectType]![1] = value;
                setPrompts(newPromptsState);
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
          </div>
        )}
      </div>
      <div className="flex justify-between gap-3">
        <button
          className={`bg-[#3B68FF] px-12 !text-white !border-none flex items-center justify-center ${isLoading || !imageSrc ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={handleSend}
          disabled={isLoading || !imageSrc}>
          {isLoading ? (
            <>
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Sending...
            </>
          ) : (
            'Send'
          )}
        </button>
        <label className="flex items-center gap-2">
          temperature:
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            disabled={isLoading}
          />
          {temperature}
        </label>
      </div>
      {responseTime && (
        <div className="text-sm text-gray-500 mt-2">{responseTime}</div>
      )}
    </div>
  );
}
