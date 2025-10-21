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

import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Type,
  FunctionDeclaration,
} from '@google/genai';
import {useAtom, useAtomValue} from 'jotai';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ApiKeyAtom,
  BoundingBoxesAtom,
  ConnectionStateAtom,
  Transcript,
  TranscriptsAtom,
} from './atoms';
import {BoundingBox2DType} from './Types';
import {blobToBase64, decode, decodeAudioData, encode} from './utils';

const FRAME_RATE = 2; // frames per second
const JPEG_QUALITY = 0.7;

const highlightObjectFunctionDeclaration: FunctionDeclaration = {
  name: 'highlight_object',
  parameters: {
    type: Type.OBJECT,
    description:
      'Highlights a specified object in the camera feed by drawing a bounding box around it.',
    properties: {
      label: {
        type: Type.STRING,
        description: 'A descriptive label for the object being highlighted.',
      },
      box_2d: {
        type: Type.ARRAY,
        description:
          'The bounding box coordinates [ymin, xmin, ymax, xmax] normalized to 0-1000.',
        items: {
          type: Type.NUMBER,
        },
      },
    },
    required: ['label', 'box_2d'],
  },
};

export function Conversation() {
  const [connectionState, setConnectionState] = useAtom(ConnectionStateAtom);
  const [transcripts, setTranscripts] = useAtom(TranscriptsAtom);
  const [boundingBoxes, setBoundingBoxes] = useAtom(BoundingBoxesAtom);
  const apiKey = useAtomValue(ApiKeyAtom);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // FIX: LiveSession is not an exported member of @google/genai. Use `any` for the session object.
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const animationFrameId = useRef<number>();
  const boxTimeoutRef = useRef<number | null>(null);

  const startConversation = async () => {
    if (!apiKey) {
      alert('Please set your API key first.');
      return;
    }
    const ai = new GoogleGenAI({apiKey});

    setConnectionState('connecting');
    setTranscripts([]);
    // FIX: A state setter must be called with an argument.
    // Changed setBoundingBoxes() to setBoundingBoxes([]) to correctly clear the state.
    setBoundingBoxes([]);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {facingMode: 'environment'},
      });
      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // FIX: Cast window to `any` to allow for `webkitAudioContext` for Safari compatibility.
      const inputAudioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)({sampleRate: 16000});
      audioContextRef.current = inputAudioContext;
      // FIX: Cast window to `any` to allow for `webkitAudioContext` for Safari compatibility.
      const outputAudioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)({sampleRate: 24000});
      let nextStartTime = 0;

      // FIX: The `ai.live.connect` call was failing due to a type error within the `onaudioprocess` callback.
      // Fixing the callback resolves the issue.
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}}},
          systemInstruction:
            'You are a helpful AI assistant. The user is streaming their camera and microphone to you. Your goal is to help them understand and interact with their environment. Answer their questions about what they are seeing. When you verbally refer to a specific object that is visible in the camera feed, you MUST use the provided `highlight_object` tool to draw a box around it. Be conversational and helpful.',
          tools: [{functionDeclarations: [highlightObjectFunctionDeclaration]}],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setConnectionState('connected');
            const source = inputAudioContext.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContext.createScriptProcessor(
              4096,
              1,
              1,
            );
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData =
                audioProcessingEvent.inputBuffer.getChannelData(0);
              // FIX: Float32Array does not have a `.map` method. Converted to use a loop.
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({media: pcmBlob});
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContext.destination);

            if (frameIntervalRef.current)
              clearInterval(frameIntervalRef.current);
            frameIntervalRef.current = window.setInterval(() => {
              const tempCanvas = document.createElement('canvas');
              if (videoRef.current && tempCanvas) {
                tempCanvas.width = videoRef.current.videoWidth;
                tempCanvas.height = videoRef.current.videoHeight;
                tempCanvas
                  .getContext('2d')
                  ?.drawImage(
                    videoRef.current,
                    0,
                    0,
                    videoRef.current.videoWidth,
                    videoRef.current.videoHeight,
                  );
                tempCanvas.toBlob(
                  async (blob) => {
                    if (blob) {
                      const base64Data = await blobToBase64(blob);
                      sessionPromiseRef.current?.then((session) => {
                        session.sendRealtimeInput({
                          media: {data: base64Data, mimeType: 'image/jpeg'},
                        });
                      });
                    }
                  },
                  'image/jpeg',
                  JPEG_QUALITY,
                );
              }
            }, 1000 / FRAME_RATE);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              setTranscripts((prev) => {
                const last = prev[prev.length - 1];
                if (last?.source === 'user' && !last.isFinal) {
                  return [...prev.slice(0, -1), {...last, text: last.text + text}];
                }
                return [...prev, {source: 'user', text, isFinal: false}];
              });
            } else if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
               setTranscripts((prev) => {
                const last = prev[prev.length - 1];
                if (last?.source === 'model' && !last.isFinal) {
                  return [...prev.slice(0, -1), {...last, text: last.text + text}];
                }
                return [...prev, {source: 'model', text, isFinal: false}];
              });
            }

            if (message.serverContent?.turnComplete) {
              setTranscripts(prev => prev.map(t => ({...t, isFinal: true})))
            }

            if (message.toolCall?.functionCalls) {
              // FIX: Cast functionCalls to `any[]` to allow iteration and access to properties.
              for (const fc of message.toolCall.functionCalls as any[]) {
                if (fc.name === 'highlight_object' && fc.args.box_2d) {
                  const [ymin, xmin, ymax, xmax] = fc.args.box_2d;
                  const newBox: BoundingBox2DType = {
                    x: xmin / 1000,
                    y: ymin / 1000,
                    width: (xmax - xmin) / 1000,
                    height: (ymax - ymin) / 1000,
                    // FIX: `fc.args.label` is now accessible and assignable to string.
                    label: fc.args.label,
                  };
                  setBoundingBoxes([newBox]); // Show one box at a time

                  if (boxTimeoutRef.current) {
                    clearTimeout(boxTimeoutRef.current);
                  }
                  boxTimeoutRef.current = window.setTimeout(() => {
                    setBoundingBoxes([]);
                    boxTimeoutRef.current = null;
                  }, 3000);
                }

                sessionPromiseRef.current?.then((session) => {
                  session.sendToolResponse({
                    functionResponses: {
                      id: fc.id,
                      name: fc.name,
                      response: {result: 'ok'},
                    },
                  });
                });
              }
            }

            const base64Audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
            if (base64Audio) {
              nextStartTime = Math.max(
                nextStartTime,
                outputAudioContext.currentTime,
              );
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                outputAudioContext,
                24000,
                1,
              );
              const source = outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputAudioContext.destination);
              source.start(nextStartTime);
              nextStartTime += audioBuffer.duration;
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error(e);
            setConnectionState('error');
            stopConversation();
            if (e.message.includes('API key not valid')) {
                alert('Your API key is not valid. Please check your key and refresh the page to try again.');
                localStorage.removeItem('gemini_api_key');
                window.location.reload();
            }
          },
          onclose: (e: CloseEvent) => {
            setConnectionState('closed');
            stopConversation();
          },
        },
      });
    } catch (err) {
      console.error(err);
      setConnectionState('error');
    }
  };

  const stopConversation = useCallback(() => {
    sessionPromiseRef.current?.then((session) => session.close());
    sessionPromiseRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = null;
    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    if (boxTimeoutRef.current) clearTimeout(boxTimeoutRef.current);
    setConnectionState('idle');
    setBoundingBoxes([]);
  }, [setConnectionState, setBoundingBoxes]);

  const draw = useCallback(() => {
    if (
      canvasRef.current &&
      videoRef.current &&
      videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA
    ) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;

      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = canvas.width / canvas.height;
      let drawWidth = canvas.width;
      let drawHeight = canvas.height;
      let x = 0;
      let y = 0;

      if (videoRatio > canvasRatio) {
        drawHeight = canvas.width / videoRatio;
        y = (canvas.height - drawHeight) / 2;
      } else {
        drawWidth = canvas.height * videoRatio;
        x = (canvas.width - drawWidth) / 2;
      }

      ctx.drawImage(video, x, y, drawWidth, drawHeight);

      boundingBoxes.forEach((box) => {
        ctx.strokeStyle = '#7FBBFF';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.rect(
          x + box.x * drawWidth,
          y + box.y * drawHeight,
          box.width * drawWidth,
          box.height * drawHeight,
        );
        ctx.stroke();

        ctx.fillStyle = '#7FBBFF';
        ctx.font = '20px Space Mono';
        ctx.fillText(box.label, x + box.x * drawWidth + 5, y + box.y * drawHeight + 20);
      });
    }
    animationFrameId.current = requestAnimationFrame(draw);
  }, [boundingBoxes]);


  useEffect(() => {
    animationFrameId.current = requestAnimationFrame(draw);
    return () => {
      if(animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      stopConversation();
    }
  }, [draw, stopConversation]);


  const isProcessing =
    connectionState === 'connected' || connectionState === 'connecting';

  return (
    <div className="w-full h-full flex bg-black">
      {/* Camera Feed Area */}
      <div className="flex-grow h-full relative">
        <video ref={videoRef} className="hidden" playsInline muted></video>
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full"></canvas>
      </div>

      {/* Sidebar */}
      <div className="w-96 flex-shrink-0 h-full flex flex-col bg-[#1C1F21] border-l border-[#37393c]">
        {/* Header */}
        <div className="p-4 border-b border-[#37393c] text-center">
          <h1 className="text-xl font-bold">Live AI Assistant</h1>
          <p className="text-sm text-gray-400 mt-1">Real-time object interaction</p>
        </div>

        {/* Transcripts */}
        <div className="flex-grow p-4 overflow-y-auto">
          <div className="flex flex-col gap-4">
            {transcripts.length === 0 && (
              <div className="text-center text-gray-400 flex-grow flex items-center justify-center h-full">
                <p>
                  {connectionState === 'connected'
                    ? 'The session is live. Start speaking to the assistant.'
                    : 'Click "Start Session" to begin.'}
                </p>
              </div>
            )}
            {transcripts.map((t, i) => (
              <div
                key={i}
                className={`flex flex-col ${t.source === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`rounded-lg px-3 py-2 max-w-[85%] ${
                    t.source === 'user' ? 'bg-blue-600' : 'bg-gray-600'
                  }`}
                >
                  <div className="font-bold text-sm capitalize text-gray-300">
                    {t.source === 'model' ? 'Assistant' : 'You'}
                  </div>
                  <p className="text-white whitespace-pre-wrap">{t.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="p-4 border-t border-[#37393c] flex flex-col items-center gap-3">
          <div className="text-sm bg-black px-3 py-1 rounded-full">
            Status: {connectionState.charAt(0).toUpperCase() + connectionState.slice(1)}
          </div>
          <button
            onClick={isProcessing ? stopConversation : startConversation}
            className={`w-full py-3 text-base font-bold rounded-full border-none transition-colors ${
              isProcessing
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            } text-white`}
          >
            {isProcessing ? 'Stop Session' : 'Start Session'}
          </button>
        </div>
      </div>
    </div>
  );
}
