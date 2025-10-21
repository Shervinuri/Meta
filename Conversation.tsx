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
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const boxTimeoutRef = useRef<number | null>(null);

  const stopAISession = useCallback(() => {
    sessionPromiseRef.current?.then((session) => session.close());
    sessionPromiseRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    audioContextRef.current = null;
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = null;
    if (boxTimeoutRef.current) clearTimeout(boxTimeoutRef.current);
    boxTimeoutRef.current = null;
    setConnectionState('idle');
    setBoundingBoxes([]);
  }, [setConnectionState, setBoundingBoxes]);

  const startConversation = async () => {
    if (!apiKey) {
      alert('Please set your API key first.');
      return;
    }

    if (!mediaStreamRef.current) {
      alert(
        'Camera stream not available. Please wait for it to load or check permissions.',
      );
      return;
    }

    const ai = new GoogleGenAI({apiKey});

    setConnectionState('connecting');
    setTranscripts([]);
    setBoundingBoxes([]);

    try {
      const stream = mediaStreamRef.current;

      const inputAudioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)({sampleRate: 16000});
      audioContextRef.current = inputAudioContext;
      const outputAudioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)({sampleRate: 24000});
      let nextStartTime = 0;

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
          },
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
                  return [
                    ...prev.slice(0, -1),
                    {...last, text: last.text + text},
                  ];
                }
                return [...prev, {source: 'user', text, isFinal: false}];
              });
            } else if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              setTranscripts((prev) => {
                const last = prev[prev.length - 1];
                if (last?.source === 'model' && !last.isFinal) {
                  return [
                    ...prev.slice(0, -1),
                    {...last, text: last.text + text},
                  ];
                }
                return [...prev, {source: 'model', text, isFinal: false}];
              });
            }

            if (message.serverContent?.turnComplete) {
              setTranscripts((prev) =>
                prev.map((t) => ({...t, isFinal: true})),
              );
            }

            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls as any[]) {
                if (fc.name === 'highlight_object' && fc.args.box_2d) {
                  const [ymin, xmin, ymax, xmax] = fc.args.box_2d;
                  const newBox: BoundingBox2DType = {
                    x: xmin / 1000,
                    y: ymin / 1000,
                    width: (xmax - xmin) / 1000,
                    height: (ymax - ymin) / 1000,
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
            stopAISession();
            if (e.message.includes('API key not valid')) {
              alert(
                'Your API key is not valid. Please check your key and refresh the page to try again.',
              );
              localStorage.removeItem('gemini_api_key');
              window.location.reload();
            }
          },
          onclose: (e: CloseEvent) => {
            setConnectionState('closed');
            stopAISession();
          },
        },
      });
    } catch (err) {
      console.error(err);
      setConnectionState('error');
      stopAISession();
    }
  };

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
        ctx.strokeRect(
          x + box.x * drawWidth,
          y + box.y * drawHeight,
          box.width * drawWidth,
          box.height * drawHeight,
        );

        const label = box.label;
        const padding = 8;
        const fontHeight = 18;
        ctx.font = `bold ${fontHeight}px "Space Mono"`;
        const textMetrics = ctx.measureText(label);

        // Label background
        ctx.fillStyle = '#7FBBFF';
        ctx.fillRect(
          x + box.x * drawWidth - 2,
          y + box.y * drawHeight - (fontHeight + padding) - 2,
          textMetrics.width + padding * 2,
          fontHeight + padding,
        );

        // Label text
        ctx.fillStyle = 'black';
        ctx.fillText(
          label,
          x + box.x * drawWidth + padding,
          y + box.y * drawHeight - padding / 2 - 2,
        );
      });
    }
  }, [boundingBoxes]);

  useEffect(() => {
    let isMounted = true;
    let localAnimationFrameId: number;

    async function setupCameraAndDraw() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: {facingMode: 'environment'},
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const drawLoop = () => {
          if (!isMounted) return;
          draw();
          localAnimationFrameId = requestAnimationFrame(drawLoop);
        };
        drawLoop();
      } catch (err) {
        console.error('Error accessing media devices.', err);
        if (isMounted) {
          alert(
            'Could not access camera/microphone. Please check permissions and refresh the page.',
          );
        }
      }
    }

    setupCameraAndDraw();

    return () => {
      isMounted = false;
      cancelAnimationFrame(localAnimationFrameId);
      stopAISession();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    };
  }, [draw, stopAISession]);

  const isProcessing =
    connectionState === 'connected' || connectionState === 'connecting';

  const statusInfo = {
    idle: {color: 'bg-gray-500', text: 'Idle'},
    connecting: {color: 'bg-yellow-500 animate-pulse', text: 'Connecting...'},
    connected: {color: 'bg-green-500', text: 'Connected'},
    error: {color: 'bg-red-500', text: 'Error'},
    closed: {color: 'bg-gray-500', text: 'Closed'},
  }[connectionState];

  return (
    <div className="w-full h-full flex bg-black">
      {/* Camera Feed Area */}
      <div className="flex-1 h-full relative overflow-hidden bg-black">
        <video ref={videoRef} className="hidden" playsInline muted></video>
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
        ></canvas>
      </div>

      {/* Sidebar */}
      <div className="w-96 flex-shrink-0 h-full flex flex-col bg-zinc-900 border-l border-zinc-700">
        {/* Header */}
        <div className="p-4 border-b border-zinc-700 text-center">
          <h1 className="text-xl font-bold">Live AI Assistant</h1>
          <div className="text-xs text-zinc-400 mt-2 font-mono">
            Model: gemini-2.5-flash-native-audio-preview-09-2025
          </div>
        </div>

        {/* Transcripts */}
        <div className="flex-grow p-4 overflow-y-auto">
          <div className="flex flex-col gap-4">
            {transcripts.length === 0 && (
              <div className="text-center text-zinc-400 flex-grow flex items-center justify-center h-full">
                <p className="max-w-xs">
                  {connectionState === 'connected'
                    ? 'The session is live. Start speaking to the assistant.'
                    : "Press 'Start Session' and begin your conversation. The AI is ready to listen."}
                </p>
              </div>
            )}
            {transcripts.map((t, i) => (
              <div
                key={i}
                className={`flex gap-3 ${
                  t.source === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {t.source === 'model' && (
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-5 h-5 text-zinc-300"
                    >
                      <path d="M12 2a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1Zm0 18a1 1 0 0 1-1 1v1a1 1 0 0 1 2 0v-1a1 1 0 0 1-1-1Zm7-7a1 1 0 0 1 1 1h1a1 1 0 0 1 0 2h-1a1 1 0 0 1-1-1Zm-15 0a1 1 0 0 1-1-1H2a1 1 0 0 1 0-2h1a1 1 0 0 1 1 1Zm2.929-4.071a1 1 0 0 1 1.414 0l.707.707a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414Zm10.607 9.193a1 1 0 0 1 1.414 0l.707.707a1 1 0 0 1-1.414 1.414l-.707-.707a1 1 0 0 1 0-1.414ZM6.929 6.222a1 1 0 0 1 0 1.414l-.707.707A1 1 0 0 1 4.808 7.63l.707-.707a1 1 0 0 1 1.414 0Zm11.314 9.899a1 1 0 0 1 0 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0ZM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" />
                    </svg>
                  </div>
                )}
                <div
                  className={`rounded-lg px-4 py-2 max-w-[85%] ${
                    t.source === 'user' ? 'bg-blue-700' : 'bg-zinc-700'
                  }`}
                >
                  <p className="text-white whitespace-pre-wrap">{t.text}</p>
                </div>
                {t.source === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-5 h-5 text-zinc-300"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="p-4 border-t border-zinc-700 flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-sm bg-zinc-950 px-3 py-1 rounded-full">
            <div className={`w-3 h-3 rounded-full ${statusInfo.color}`}></div>
            <span>{statusInfo.text}</span>
          </div>
          <button
            onClick={isProcessing ? stopAISession : startConversation}
            className={`w-full py-3 text-base font-bold rounded-full border-none transition-colors flex items-center justify-center gap-2 ${
              isProcessing
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            } text-white`}
          >
            {isProcessing ? (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z"
                    clipRule="evenodd"
                  />
                </svg>
                Stop Session
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-6 h-6"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.647c1.295.742 1.295 2.545 0 3.286L7.279 20.99c-1.25.717-2.779-.217-2.779-1.643V5.653Z"
                    clipRule="evenodd"
                  />
                </svg>
                Start Session
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
