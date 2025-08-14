import React, { useState, useRef, useEffect, useCallback, ReactNode } from 'react';
import ReactMarkdown from 'https://esm.sh/react-markdown@9';
import remarkGfm from 'https://esm.sh/remark-gfm@4';
import { AppStatus } from './types';
import { MicrophoneIcon, StopIcon, SparklesIcon, CopyIcon, CheckIcon, ResetIcon, PaperAirplaneIcon, DocumentTextIcon } from './components/icons';
import { generateMinutesFromText, transcribeAudio } from './services/geminiService';


interface CardProps {
    children: ReactNode;
    className?: string;
}

const Card: React.FC<CardProps> = ({ children, className }) => (
    <div className={`bg-gray-800/60 backdrop-blur-sm p-6 sm:p-8 rounded-2xl shadow-2xl border border-gray-700/50 transition-all duration-300 ${className}`}>
        {children}
    </div>
);

interface ActionButtonProps {
    onClick: () => unknown;
    disabled?: boolean;
    children: ReactNode;
    className?: string;
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, disabled, children, className }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center justify-center gap-2 px-6 py-3 font-semibold text-white rounded-full shadow-lg transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
        {children}
    </button>
);

const App = () => {
    const [status, setStatus] = useState<AppStatus>(AppStatus.Idle);
    const [minutes, setMinutes] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [recordingTime, setRecordingTime] = useState(0);
    const [transcriptionInput, setTranscriptionInput] = useState('');

    // State for UI controls
    const [isCopied, setIsCopied] = useState(false);
    const [isFormattedCopied, setIsFormattedCopied] = useState(false);
    const [isSummaryCopied, setIsSummaryCopied] = useState(false);
    const [isProjectNameCopied, setIsProjectNameCopied] = useState(false);
    const [isSendingToNotion, setIsSendingToNotion] = useState(false);
    const [notionSendSuccess, setNotionSendSuccess] = useState<boolean | null>(null);
    const [loadingMessage, setLoadingMessage] = useState('');

    // Refs for audio processing
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamsRef = useRef<MediaStream[]>([]);
    const audioContextRef = useRef<AudioContext | null>(null);
    const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);


    const loadingMessages = [
        "Analizando la transcripción...",
        "Identificando los puntos clave...",
        "Estructurando decisiones y acuerdos...",
        "Dando formato a la minuta...",
        "Casi listo..."
    ];

    useEffect(() => {
        if (status === AppStatus.Generating) {
            setLoadingMessage(loadingMessages[0]);
            let i = 1;
            const interval = setInterval(() => {
                setLoadingMessage(loadingMessages[i % loadingMessages.length]);
                i++;
            }, 2500);
            return () => clearInterval(interval);
        }
    }, [status, loadingMessages]);

    const cleanupStreams = useCallback(() => {
        streamsRef.current.forEach(stream => stream.getTracks().forEach(track => track.stop()));
        streamsRef.current = [];
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
        }
        audioContextRef.current = null;
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
        }
    }, []);

    const handleReset = useCallback(() => {
        cleanupStreams();
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
        
        setStatus(AppStatus.Idle);
        setMinutes('');
        setError(null);
        setRecordingTime(0);
        setTranscriptionInput('');
        setIsCopied(false);
        setIsFormattedCopied(false);
        setIsSummaryCopied(false);
        setIsProjectNameCopied(false);
        setIsSendingToNotion(false);
        setNotionSendSuccess(null);
    }, [cleanupStreams]);
    
    // Cleanup on component unmount
    useEffect(() => {
        return () => {
            cleanupStreams();
        };
    }, [cleanupStreams]);

    const generateAndSetMinutes = useCallback(async (transcription: string) => {
        if (!transcription.trim()) {
            setError("La transcripción no puede estar vacía.");
            setStatus(AppStatus.Error);
            return;
        }
        setStatus(AppStatus.Generating);
        const minutesResult = await generateMinutesFromText(transcription);

        if (minutesResult.startsWith('Error')) {
            setError(minutesResult);
            setStatus(AppStatus.Error);
        } else {
            setMinutes(minutesResult);
            setStatus(AppStatus.Done);
        }
    }, []);

    const handleStartRecording = async () => {
        handleReset();
        try {
            // 1. Get streams for both screen/tab audio and microphone
            const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            const userStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamsRef.current = [displayStream, userStream];

            // 2. Mix audio streams
            const context = new AudioContext();
            audioContextRef.current = context;
            const destination = context.createMediaStreamDestination();

            // Connect microphone audio
            const userSource = context.createMediaStreamSource(userStream);
            userSource.connect(destination);

            // Conditionally connect screen audio if it exists
            if (displayStream.getAudioTracks().length > 0) {
                const displaySource = context.createMediaStreamSource(displayStream);
                displaySource.connect(destination);
            }
            
            const mixedStream = destination.stream;

            // 3. Record the mixed stream
            mediaRecorderRef.current = new MediaRecorder(mixedStream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorderRef.current.onstop = async () => {
                cleanupStreams();
                if (audioChunksRef.current.length === 0) {
                    setError("La grabación no contiene datos de audio. Por favor, inténtelo de nuevo.");
                    setStatus(AppStatus.Error);
                    return;
                }
                
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                
                setStatus(AppStatus.Transcribing);
                const transcriptionResult = await transcribeAudio(audioBlob);

                if (transcriptionResult.startsWith('Error:')) {
                    setError(transcriptionResult);
                    setStatus(AppStatus.Error);
                    return;
                }
                
                await generateAndSetMinutes(transcriptionResult);
            };

            mediaRecorderRef.current.start();
            setStatus(AppStatus.Recording);
            
            // Start timer
            setRecordingTime(0);
            timerIntervalRef.current = setInterval(() => {
                setRecordingTime(prevTime => prevTime + 1);
            }, 1000);

        } catch (err) {
            console.error("Error starting recording:", err);
            let message = "Ocurrió un error al iniciar la grabación.";
            if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')) {
                message = "Permiso denegado para capturar pantalla o micrófono. Por favor, conceda los permisos necesarios e inténtelo de nuevo.";
            }
            setError(message);
            setStatus(AppStatus.Error);
            cleanupStreams();
        }
    };

    const handleStopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
        }
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
        }
    };

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return h === '00' ? `${m}:${s}` : `${h}:${m}:${s}`;
    };

    const handleCopy = useCallback(() => {
        const markdownContent = minutes.split('---').slice(1).join('---').trim();
        navigator.clipboard.writeText(markdownContent);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    }, [minutes]);
    
    const handleCopySummary = useCallback(() => {
        const summaryText = minutes.split('---')[0].trim();
        if (summaryText) {
            navigator.clipboard.writeText(summaryText);
            setIsSummaryCopied(true);
            setTimeout(() => setIsSummaryCopied(false), 2000);
        }
    }, [minutes]);

    const handleCopyProjectName = useCallback((projectName: string) => {
        if (projectName && projectName !== 'No se especifica') {
            navigator.clipboard.writeText(projectName);
            setIsProjectNameCopied(true);
            setTimeout(() => setIsProjectNameCopied(false), 2000);
        }
    }, []);
    
    const markdownToHtml = (markdownText: string): string => {
        let html = '';
        const lines = markdownText.split('\n');
        let inList = false;

        const closeList = () => {
            if (inList) {
                html += '</ul>\n';
                inList = false;
            }
        };
        
        for (const line of lines) {
            let processedLine = line.trim();
            if (processedLine === '') {
                closeList();
                continue;
            }

            processedLine = processedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            if (processedLine.startsWith('### ')) {
                closeList();
                html += `<h3>${processedLine.replace('### ', '')}</h3>\n`;
            } 
            else if (processedLine.match(/^\s*(\*|-|\[ \])\s/)) {
                 if (!inList) {
                    html += '<ul>\n';
                    inList = true;
                }
                html += `<li>${processedLine.replace(/^\s*(\*|-|\[ \])\s*/, '')}</li>\n`;
            } 
            else {
                closeList();
                html += `<p>${processedLine}</p>\n`;
            }
        }
        
        closeList();
        return html;
    };
    
    const handleCopyFormatted = useCallback(() => {
        const markdownContent = minutes.split('---').slice(1).join('---').trim();
        if (!markdownContent) return;

        try {
            const htmlContent = markdownToHtml(markdownContent);
            const blob = new Blob([htmlContent], { type: 'text/html' });
            const data = [new ClipboardItem({ 'text/html': blob })];
            
            navigator.clipboard.write(data).then(
                () => {
                    setIsFormattedCopied(true);
                    setTimeout(() => setIsFormattedCopied(false), 2000);
                },
                (err) => {
                    console.error("Failed to copy HTML to clipboard:", err);
                    setError("No se pudo copiar con formato. Su navegador podría no ser compatible. Intente 'Copiar Markdown'.");
                }
            );
        } catch (err) {
            console.error("Error creating HTML content:", err);
            setError("Ocurrió un error al generar el contenido con formato.");
        }
    }, [minutes]);


    // Helper to convert markdown bold (**text**) to Notion's rich_text format
    const createTextWithBold = (text: string) => {
        const parts = text.split('**');
        const richText: any[] = [];
        parts.forEach((part, index) => {
            if (part) { // Avoid adding empty strings
                richText.push({
                    type: 'text',
                    text: { content: part },
                    annotations: {
                        bold: index % 2 === 1, // Every odd-indexed part is bold
                    },
                });
            }
        });
        return richText;
    };
    
    const parseMarkdownToNotionBlocks = (markdown: string) => {
        const blocks: any[] = [];
        const sections = markdown.split(/(?=###\s)/).filter(s => s.trim() !== '');
    
        for (const section of sections) {
            const lines = section.trim().split('\n').filter(line => line.trim() !== '');
            if (lines.length === 0) continue;
    
            const title = lines[0].replace('### ', '').trim();
            blocks.push({
                object: 'block',
                type: 'heading_3',
                heading_3: { rich_text: createTextWithBold(title) }
            });
    
            const contentLines = lines.slice(1);
    
            if (title.includes('Compromisos y tareas')) {
                for (const line of contentLines) {
                    const taskText = line.replace(/\[ \]\s*/, '').trim();
                    if (taskText) {
                        blocks.push({
                            object: 'block',
                            type: 'to_do',
                            to_do: {
                                rich_text: createTextWithBold(taskText),
                                checked: false
                            }
                        });
                    }
                }
            } else {
                for (const line of contentLines) {
                    const cleanedLine = line.replace(/^\s*[\*\-]\s*/, '').trim();
                     if (cleanedLine) {
                        const bulletedLine = `• ${cleanedLine}`;
                        blocks.push({
                            object: 'block',
                            type: 'paragraph',
                            paragraph: {
                                rich_text: createTextWithBold(bulletedLine)
                            }
                        });
                    }
                }
            }
        }
    
        return blocks;
    };

    const handleSendToNotion = useCallback(async () => {
        setIsSendingToNotion(true);
        setNotionSendSuccess(null);
        setError(null);

        try {
            const [summaryText, ...markdownParts] = minutes.split('---');
            const rawMarkdown = markdownParts.join('---').trim();

            const projectNameRegex = /### 1\. Nombre del proyecto o asunto\s*\n\s*\*?\s*(.*?)\s*\n/s;
            const projectNameMatch = rawMarkdown.match(projectNameRegex);
            const projectName = projectNameMatch ? projectNameMatch[1].trim() : 'Minuta de Reunión';
            
            const notionBlocks = parseMarkdownToNotionBlocks(rawMarkdown);

            if (notionBlocks.length === 0) {
                throw new Error("No se pudo procesar la minuta para Notion.");
            }
            
            const payload = {
                titulo: projectName,
                resumen: summaryText.trim(),
                fecha: new Date().toISOString(),
                bloques_notion: notionBlocks
            };

            const response = await fetch('https://hook.us1.make.com/1murl9o10b6o5mfcc9gwbgst85qdiee6', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Error del servidor: ${response.status} - ${errorText}`);
            }

            setNotionSendSuccess(true);

        } catch (err) {
            console.error("Error sending to Notion:", err);
            const errorMessage = err instanceof Error ? err.message : "No se pudo enviar la minuta a Notion. Por favor, intente de nuevo.";
            setError(errorMessage);
            setNotionSendSuccess(false);
        } finally {
            setIsSendingToNotion(false);
        }
    }, [minutes]);

    const renderContent = () => {
        switch (status) {
             case AppStatus.Recording:
                return (
                    <div className="text-center flex flex-col items-center gap-6">
                        <div className="flex items-center gap-3 text-red-400">
                           <span className="relative flex h-3 w-3">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                            </span>
                            <p className="text-lg font-medium">Grabando reunión completa...</p>
                        </div>
                        <p className="text-5xl font-mono font-bold text-white">{formatTime(recordingTime)}</p>
                        <ActionButton onClick={handleStopRecording} className="bg-red-600 hover:bg-red-700 focus:ring-red-500">
                            <StopIcon className="w-6 h-6" />
                            <span>Detener y Procesar</span>
                        </ActionButton>
                    </div>
                );
            case AppStatus.Transcribing:
                 return (
                    <div className="flex flex-col items-center gap-4 text-center">
                        <div className="w-12 h-12 border-4 border-t-transparent border-blue-400 rounded-full animate-spin"></div>
                        <p className="text-xl font-semibold text-blue-300">Transcribiendo audio...</p>
                        <p className="text-gray-400 max-w-sm">Este proceso puede tardar unos minutos dependiendo de la duración de la grabación. Por favor, no cierre esta ventana.</p>
                    </div>
                );
            case AppStatus.ReadyToGenerate:
                return (
                    <div className="w-full flex flex-col gap-6">
                        <h2 className="text-2xl font-bold text-center text-gray-100">Usar Texto Existente</h2>
                        <p className="text-gray-400 text-center">Pegue aquí la transcripción de su reunión para generar la minuta.</p>
                        <textarea
                            className="w-full h-64 p-4 bg-gray-900 border-2 border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-200 resize-none"
                            value={transcriptionInput}
                            onChange={(e) => setTranscriptionInput(e.target.value)}
                            placeholder="Pegue aquí la transcripción completa de su reunión..."
                        />
                        <div className="flex justify-center gap-4">
                            <ActionButton onClick={handleReset} className="bg-gray-600 hover:bg-gray-700 focus:ring-gray-500">
                                <ResetIcon className="w-6 h-6"/>
                                <span>Cancelar</span>
                            </ActionButton>
                            <ActionButton onClick={() => generateAndSetMinutes(transcriptionInput)} disabled={!transcriptionInput.trim()} className="bg-blue-600 hover:bg-blue-700 focus:ring-blue-500">
                                <SparklesIcon className="w-6 h-6" />
                                <span>Generar Minuta</span>
                            </ActionButton>
                        </div>
                    </div>
                );
            case AppStatus.Generating:
                return (
                    <div className="flex flex-col items-center gap-4 text-center">
                        <div className="w-12 h-12 border-4 border-t-transparent border-cyan-400 rounded-full animate-spin"></div>
                        <p className="text-xl font-semibold text-cyan-300">Generando minuta...</p>
                        <p className="text-gray-400 transition-opacity duration-500">{loadingMessage}</p>
                    </div>
                );
            case AppStatus.Done: {
                const [summary, ...markdownParts] = minutes.split('---');
                const rawMarkdown = markdownParts.join('---').trim();

                const projectNameRegex = /### 1\. Nombre del proyecto o asunto\s*\n\s*\*?\s*(.*?)\s*\n/s;
                const projectNameMatch = rawMarkdown.match(projectNameRegex);
                const projectName = projectNameMatch ? projectNameMatch[1].trim() : 'No se especifica';
                
                const restOfMarkdownStartIndex = rawMarkdown.indexOf('### 2. Objetivo de la reunión');
                const restOfMarkdown = restOfMarkdownStartIndex !== -1 ? rawMarkdown.substring(restOfMarkdownStartIndex) : rawMarkdown;

                return (
                    <div className="w-full flex flex-col gap-4">
                        <div className="p-4 bg-gray-900/70 rounded-lg border border-gray-700">
                            <div className="flex justify-between items-center">
                                <h3 className="text-xl font-bold text-cyan-400">{projectName}</h3>
                                <button
                                    onClick={() => handleCopyProjectName(projectName)}
                                    className="text-gray-400 hover:text-white transition-colors p-1 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label="Copiar nombre del proyecto"
                                    disabled={!projectName || projectName === 'No se especifica'}
                                >
                                    {isProjectNameCopied ? <CheckIcon className="w-5 h-5 text-green-400" /> : <CopyIcon className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <div className="p-4 bg-gray-900/70 rounded-lg border border-gray-700">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-lg font-semibold text-gray-200">Resumen</h3>
                                <button
                                    onClick={handleCopySummary}
                                    className="text-gray-400 hover:text-white transition-colors p-1 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                    aria-label="Copiar resumen"
                                >
                                    {isSummaryCopied ? <CheckIcon className="w-5 h-5 text-green-400" /> : <CopyIcon className="w-5 h-5" />}
                                </button>
                            </div>
                            <p className="text-gray-300">{summary.trim()}</p>
                        </div>
                        
                        <div className="prose prose-invert max-w-none p-4 bg-gray-900/70 rounded-lg border border-gray-700 h-64 overflow-y-auto">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                                h3: ({...props}) => <h3 className="text-xl font-semibold mt-4 mb-2 text-cyan-400 border-b border-gray-600 pb-1" {...props} />,
                                ul: ({...props}) => <ul className="list-disc list-inside space-y-1" {...props} />,
                                li: ({...props}) => <li className="text-gray-300" {...props} />,
                                p: ({...props}) => <p className="text-gray-300" {...props}/>,
                                strong: ({...props}) => <strong className="font-semibold text-gray-100" {...props}/>,
                            }}>
                                {restOfMarkdown}
                            </ReactMarkdown>
                        </div>

                        <div className="flex flex-wrap justify-center gap-4">
                             <ActionButton onClick={handleCopy} className="bg-green-700 hover:bg-green-800 focus:ring-green-600">
                                {isCopied ? <CheckIcon className="w-6 h-6" /> : <CopyIcon className="w-6 h-6" />}
                                <span>{isCopied ? 'Copiado!' : 'Copiar Markdown'}</span>
                            </ActionButton>
                            <ActionButton onClick={handleCopyFormatted} className="bg-sky-600 hover:bg-sky-700 focus:ring-sky-500">
                                {isFormattedCopied ? <CheckIcon className="w-6 h-6" /> : <CopyIcon className="w-6 h-6" />}
                                <span>{isFormattedCopied ? 'Copiado!' : 'Copiar con Formato'}</span>
                            </ActionButton>
                             {/*
                             <ActionButton
                                onClick={handleSendToNotion}
                                disabled={isSendingToNotion || notionSendSuccess === true}
                                className={`w-48
                                    ${notionSendSuccess === true ? 'bg-teal-600 cursor-default hover:bg-teal-600' : ''}
                                    ${notionSendSuccess === false ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' : ''}
                                    ${notionSendSuccess === null ? 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500' : ''}
                                `}
                            >
                                {isSendingToNotion ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        <span>Enviando...</span>
                                    </>
                                ) : notionSendSuccess === true ? (
                                    <>
                                        <CheckIcon className="w-6 h-6" />
                                        <span>Enviado</span>
                                    </>
                                ) : notionSendSuccess === false ? (
                                     <>
                                        <ResetIcon className="w-6 h-6" />
                                        <span>Reintentar</span>
                                    </>
                                ) : (
                                    <>
                                        <PaperAirplaneIcon className="w-6 h-6" />
                                        <span>Enviar a Notion</span>
                                    </>
                                )}
                            </ActionButton>
                            */}
                            <ActionButton onClick={handleReset} className="bg-gray-600 hover:bg-gray-700 focus:ring-gray-500">
                                <ResetIcon className="w-6 h-6"/>
                                <span>Empezar de Nuevo</span>
                            </ActionButton>
                        </div>
                    </div>
                );
            }
            case AppStatus.Error:
                 return (
                    <div className="text-center flex flex-col items-center gap-4">
                        <h2 className="text-2xl font-bold text-red-400">Ocurrió un Error</h2>
                        <p className="text-gray-300 bg-red-900/50 p-4 rounded-lg max-w-md">{error}</p>
                        <ActionButton onClick={handleReset} className="bg-blue-600 hover:bg-blue-700 focus:ring-blue-500">
                            <span>Intentar de Nuevo</span>
                        </ActionButton>
                    </div>
                );
            case AppStatus.Idle:
            default:
                return (
                    <div className="text-center flex flex-col items-center gap-6">
                        <h2 className="text-3xl font-bold">Asistente de Minutas de Reunión</h2>
                        <p className="text-gray-400 max-w-lg">Elija cómo desea comenzar. Grabe una reunión completa o pegue una transcripción existente para generar una minuta profesional.</p>
                        <div className="flex flex-col sm:flex-row gap-4 mt-4">
                            <ActionButton onClick={handleStartRecording} className="bg-blue-600 hover:bg-blue-700 focus:ring-blue-500">
                                <MicrophoneIcon className="w-6 h-6" />
                                <span>Iniciar Grabación Completa</span>
                            </ActionButton>
                             <ActionButton onClick={() => setStatus(AppStatus.ReadyToGenerate)} className="bg-gray-700 hover:bg-gray-600 focus:ring-gray-500">
                                <DocumentTextIcon className="w-6 h-6" />
                                <span>Usar Texto Existente</span>
                            </ActionButton>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4">
            <main className="w-full max-w-3xl mx-auto">
                <Card className="min-h-[30rem] flex items-center justify-center">
                    {renderContent()}
                </Card>
                <footer className="text-center mt-6 text-gray-500 text-sm">
                    <p>Desarrollado con React y Gemini API.</p>
                </footer>
            </main>
        </div>
    );
};

export default App;
