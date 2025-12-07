/**
 * BORGPTRON-CORE v0.1.1 (Refactorizado)
 * Protocolo: Tardigrade (Cloudflare Workers + Google Sheets)
 */
import { Bot, Context as GrammyContext, webhookCallback } from "grammy";

// --- 1. INTERFACES & TYPES (Satisfaciendo Type Safety) ---

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  GAS_API_URL: string;
  GAS_API_KEY: string;
  STAFF_GROUP_ID: string;
  STAFF_IDS: string;
  PRODUCTION_HOST_URL: string; 
}

// Definición estricta del Trabajo (Job)
interface Job {
  ID?: string;
  chat_id: number | string;
  client_name: string;
  vehicle_info: string;
  status: string;
  notes: string;
  progress: number;
  is_lead: boolean;
  created_at?: string;
}

// Custom Context
type MyContext = GrammyContext & { 
  env: Env;
  dbClient: (action: string, payload: any) => Promise<any>;
  waitUntil: (promise: Promise<any>) => void;
};

// Respuesta de la API GAS
interface GasApiResponse {
  ok: boolean;
  result?: any;
  error?: string;
}

// Estados de la Sesión
const STEPS = {
  IDLE: 'IDLE',
  AWAIT_NAME: 'AWAIT_NAME',
  AWAIT_VEHICLE: 'AWAIT_VEHICLE',
  AWAIT_DESC: 'AWAIT_DESC',
} as const;

// --- 2. DB CLIENT (Google Sheets Adapter) ---

const gasApiClient = (env: Env) => async (action: string, payload: any = {}) => {
  if (!env.GAS_API_URL) throw new Error("GAS_API_URL not configured.");

  const requestPayload = {
    apiKey: env.GAS_API_KEY,
    action,
    ...payload,
  };

  try {
    const response = await fetch(env.GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data: GasApiResponse = await response.json();
    if (!data.ok) {
      throw new Error(`GAS Error: ${data.error}`);
    }
    return data.result;
  } catch (err) {
    console.error(`DB Action '${action}' failed:`, err);
    throw err;
  }
};

// --- 3. SESSION UTILS ---

async function updateSession(ctx: MyContext, step: string, tempData: any, isClear: boolean = false): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  // No esperamos la respuesta para no bloquear al usuario (Fire & Forget)
  ctx.waitUntil(ctx.dbClient('WRITE_SESSION', { 
    userId, 
    currentStep: step, 
    tempData, 
    isClear 
  }));
}

function renderProgressBar(progress: number): string {
  const p = Math.max(0, Math.min(100, progress || 0));
  const filled = '█'.repeat(Math.floor(p / 10));
  const empty = '░'.repeat(10 - Math.floor(p / 10));
  return `[${filled}${empty}] ${p}%`;
}

// --- 4. BOT HANDLERS ---

function registerHandlers(bot: Bot<MyContext>) {
    
    // START
    bot.command(['start', 'agendar'], async (ctx) => {
      await updateSession(ctx, STEPS.AWAIT_NAME, {}, true);
      await ctx.reply(
        "🔧 *CITA INICIADA*\nPor favor, ingresa tu *nombre completo* para agendar.",
        { parse_mode: 'Markdown' }
      );
    });

    // ESTADO
    bot.command('estado', async (ctx) => {
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      try {
        const jobs: Job[] = await ctx.dbClient('QUERY_JOBS', { chatId });
        
        if (!jobs || jobs.length === 0) {
          return ctx.reply("❌ No encontramos vehículos activos a tu nombre. Usa /agendar.");
        }

        const job = jobs[jobs.length - 1]; // Último trabajo
        const statusText = job.status.toUpperCase().replace(/_/g, ' ');
        
        await ctx.reply(
          `🚗 *ESTADO DE TU VEHÍCULO*\n` +
          `*Orden ID:* #${job.ID}\n` +
          `*Cliente:* ${job.client_name}\n` +
          `*Vehículo:* ${job.vehicle_info}\n\n` +
          `*Estatus:* ${statusText}\n` +
          `*Progreso:* ${renderProgressBar(job.progress)}\n` +
          `*Notas:* ${job.notes || 'En revisión.'}`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        await ctx.reply("⚠️ Error consultando estado. Intenta más tarde.");
      }
    });

    // COTIZAR (LEAD MAGNET)
    bot.command('cotizar', async (ctx) => {
      const chatId = ctx.chat?.id;
      const clientName = ctx.from?.first_name || "Usuario";
      
      const jobData: Job = {
        chat_id: chatId!,
        client_name: clientName,
        vehicle_info: ctx.match?.toString() || 'Solicitud Genérica',
        status: 'LEAD',
        notes: 'Requiere cotización',
        progress: 0,
        is_lead: true
      };

      // Guardar en DB
      ctx.waitUntil(ctx.dbClient('SAVE_JOB', { jobData }));

      // Notificar al Staff
      if (ctx.env.STAFF_GROUP_ID) {
        ctx.waitUntil(ctx.api.sendMessage(
            ctx.env.STAFF_GROUP_ID, 
            `🚨 *NUEVO LEAD*\nCliente: ${clientName}\nInfo: ${jobData.vehicle_info}`,
            { parse_mode: 'Markdown' }
        ));
      }
      
      await ctx.reply("📝 Un técnico te contactará en breve para darte precio.");
    });

    // MACHINE STATE (INPUT HANDLER)
    bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return; // Ignorar comandos

      const userId = ctx.from?.id;
      const input = ctx.message.text.trim();
      
      // Leer sesión actual
      const session = await ctx.dbClient('READ_SESSION', { userId });
      const step = session.current_step || STEPS.IDLE;
      const tempData = session.temp_data || {};

      let nextStep = step;
      let replyText = "";
      
      switch (step) {
        case STEPS.AWAIT_NAME:
            if (input.length < 3) {
                replyText = "⚠️ Nombre muy corto.";
            } else {
                tempData.client_name = input;
                nextStep = STEPS.AWAIT_VEHICLE;
                replyText = "✅ Hola " + input + ". ¿Qué *marca, modelo y año* es el auto?";
                await updateSession(ctx, nextStep, tempData);
            }
            break;

        case STEPS.AWAIT_VEHICLE:
            if (input.length < 2) {
                replyText = "⚠️ Info muy corta.";
            } else {
                tempData.vehicle_info = input;
                nextStep = STEPS.AWAIT_DESC;
                replyText = "✅ Entendido. *Describe el problema o servicio* que necesitas.";
                await updateSession(ctx, nextStep, tempData);
            }
            break;

        case STEPS.AWAIT_DESC:
            // BUG FIX REQUESTED BY JULES: Usar campo 'notes' para la descripción
            const jobData: Job = {
                chat_id: ctx.chat!.id,
                client_name: tempData.client_name,
                vehicle_info: tempData.vehicle_info,
                notes: input, // <-- AQUÍ ESTÁ EL FIX
                status: 'SCHEDULED',
                progress: 0,
                is_lead: false
            };

            // Guardar Job Final
            const savePromise = ctx.dbClient('SAVE_JOB', { jobData });
            
            // Notificar Staff
            if (ctx.env.STAFF_GROUP_ID) {
                const staffMsg = `🆕 *NUEVA CITA*\nCliente: ${jobData.client_name}\nAuto: ${jobData.vehicle_info}\nFalla: ${jobData.notes}`;
                ctx.waitUntil(ctx.api.sendMessage(ctx.env.STAFF_GROUP_ID, staffMsg, { parse_mode: 'Markdown' }));
            }

            // Limpiar sesión
            await updateSession(ctx, STEPS.IDLE, {}, true);
            
            // Respuesta final al usuario
            await savePromise; // Esperar confirmación de guardado
            replyText = "✅ ¡Listo! Tu cita ha sido registrada. Te avisaremos cuando empiece el trabajo.";
            nextStep = STEPS.IDLE;
            break;

        default:
            // IDLE state, no action
            break;
      }

      if (replyText) {
          await ctx.reply(replyText, { parse_mode: 'Markdown' });
      }
    });
}

// --- 5. WORKER ENTRY ---

export default {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const bot = new Bot<MyContext>(env.TELEGRAM_BOT_TOKEN);

    bot.use(async (ctx, next) => {
      ctx.env = env;
      ctx.dbClient = gasApiClient(env);
      ctx.waitUntil = executionContext.waitUntil.bind(executionContext);
      await next();
    });

    registerHandlers(bot);

    return webhookCallback(bot, 'cloudflare-mod')(request);
  },
};