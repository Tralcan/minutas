import { GoogleGenAI } from "@google/genai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!API_KEY) {
  throw new Error("VITE_GEMINI_API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Helper to convert Blob to Base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // result is a data URL: "data:audio/webm;base64,..."
            // We need to strip the prefix
            const base64Data = (reader.result as string).split(',')[1];
            resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
    try {
        const audioData = await blobToBase64(audioBlob);
        const audioPart = {
            inlineData: {
                mimeType: audioBlob.type,
                data: audioData,
            },
        };
        const promptPart = {
            text: "Transcribe this meeting audio accurately.",
        };
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [audioPart, promptPart] },
        });

        const transcription = response.text;
        if (!transcription || transcription.trim() === '') {
            throw new Error("La transcripción resultó vacía. El audio puede no haber contenido voz clara.");
        }
        return transcription;
    } catch (error) {
        console.error("Error transcribing audio:", error);
        if (error instanceof Error) {
            // Provide a more user-friendly message for common errors.
            if (error.message.includes("La transcripción resultó vacía")) {
                return `Error: ${error.message}`;
            }
            return `Error al transcribir el audio: ${error.message}`;
        }
        return "Ocurrió un error desconocido al transcribir el audio.";
    }
}


export async function generateMinutesFromText(transcriptionText: string): Promise<string> {
  const prompt = `
    **Rol y Objetivo:**
    Actúas como un asistente experto en la creación de minutas de reuniones. Tu objetivo es transformar la siguiente transcripción en una minuta profesional, estructurada y concisa. Debes resumir y organizar el contenido en las secciones predefinidas, manteniendo siempre un tono objetivo y profesional.

    **Instrucciones y Formato de Salida:**

    1.  **Resumen Corto Inicial:**
        *   Comienza tu respuesta con un resumen de la reunión en un solo párrafo, con un máximo de 550 caracteres. Este resumen debe capturar la esencia de la discusión.

    2.  **Minuta en Formato Markdown:**
        *   Inmediatamente después del resumen, y separado por una línea horizontal (\`---\`), genera la minuta completa usando Markdown.
        *   La minuta DEBE seguir esta estructura exacta:

        ### 1. Nombre del proyecto o asunto
        * Extrae el título del proyecto o el tema principal. Si no se menciona un título explícito, crea un título conciso y descriptivo basado en el resumen y los temas tratados.

        ### 2. Objetivo de la reunión
        * Describe brevemente por qué se realizó la reunión.

        ### 3. Temas tratados
        * Enumera los puntos discutidos con viñetas. Resume cada tema.

        ### 4. Decisiones tomadas
        * Declara de forma precisa lo que se acordó, usando viñetas.

        ### 5. Compromisos y tareas
        * Lista las tareas. Para cada tarea, usa el formato \`[ ] Tarea - **Responsable:** Nombre - **Fecha:** YYYY-MM-DD\`. No uses viñetas en esta sección. Agrega un salto de línea (una línea en blanco) entre cada compromiso individual para mejorar la legibilidad.

        ### 6. Próximos pasos
        * Describe las actividades clave a monitorear antes de la siguiente reunión.

        ### 7. Próxima reunión
        * Especifica la fecha, hora y plataforma usando negritas para las etiquetas (ej. **Fecha:**, **Hora:**, **Plataforma:**). Si no se menciona, indícalo.

    **Reglas Estrictas:**
    *   NO añadas información que no esté presente en el texto de entrada, con la excepción del título del proyecto si este debe ser generado.
    *   Si una sección no puede ser completada por falta de información, escribe claramente "No se especifica".
    *   Al usar negritas, asegúrate de que no haya espacios entre los asteriscos y el texto (formato correcto: \`**Texto**\`, formato incorrecto: \`** Texto **\`).
    *   Sé directo y conciso.
    *   NO incluyas viñetas para los ítems de la sección "Compromisos y tareas", usa solo el formato de checkbox \`[ ]\`.
    *   Cada ítem con viñeta debe estar en la misma línea que el texto que le sigue.
    *   NO incluyas enlaces a secciones de la transcripción ni comentarios personales.

    **Transcripción a Procesar:**
    ---
    ${transcriptionText}
    ---
  `;

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Error generating minutes:", error);
    if (error instanceof Error) {
        return `Error al contactar la API de Gemini: ${error.message}`;
    }
    return "Ocurrió un error desconocido al generar la minuta.";
  }
}
