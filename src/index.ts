import { Bot, Context as GrammyContext, webhookCallback } from "grammy";

// --- ENVIRONMENT & CONSTANTS ---
// Environment variables are globally available in Cloudflare Workers
interface Env {
  TELEGRAM_BOT_TOKEN: string;
  GAS_API_URL: string;
  GAS_API_KEY: string;
  STAFF_GROUP_ID: string;
  STAFF_IDS: string;
  PRODUCTION_HOST_URL: string; 
}

// Custom Context to include the env object for utilities
type MyContext = GrammyContext & { 
  env: Env;
  dbClient: Function;
  waitUntil: (promise: Promise<any>) => void;
};

// --- DB INTERFACE: Google Apps Script (GAS) Client ---

interface GasApiResponse {
  ok: boolean;
  result?: any;
  error?: string;
}

/**
 * Sends authenticated requests to the Google Apps Script backend.
 * All DB operations are centralized here.
 */
const gasApiClient = (env: Env) => async (action: string, payload: any = {}) => {
  if (!env.GAS_API_URL) throw new Error("GAS_API_URL not configured.");

  const requestPayload = {
    apiKey: env.GAS_API_KEY,
    action,
    ...payload,
  };

  const response = await fetch(env.GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    throw new Error(`GAS API HTTP Error: ${response.status} ${response.statusText}`);
  }

  const data: GasApiResponse = await response.json();
  if (!data.ok) {
    throw new Error(`GAS API Logic Error: ${data.error}`);
  }
  return data.result;
};

// --- STATE MACHINE & BUSINESS LOGIC ---

const STEPS = {
  IDLE: 'IDLE',
  AWAIT_NAME: 'AWAIT_NAME',
  AWAIT_VEHICLE: 'AWAIT_VEHICLE',
  AWAIT_DESC: 'AWAIT_DESC',
};

/**
 * Fetches the session for the current user.
 */
async function getSession(ctx: MyContext, dbClient: Function): Promise<any> {
  const userId = ctx.from!.id;
  try {
    return await dbClient('READ_SESSION', { userId });
  } catch (e) {
    console.error("Failed to read session:", e);
    return { user_id: userId, current_step: STEPS.IDLE, temp_data: {} };
  }
}

/**
 * Updates the user's session state.
 */
async function updateSession(ctx: MyContext, dbClient: Function, step: string, tempData: any, isClear: boolean = false): Promise<void> {
  const userId = ctx.from!.id;
  await dbClient(
    'WRITE_SESSION',
    { userId, currentStep: step, tempData, isClear }
  );
}

/**
 * Renders an ASCII progress bar for the /estado command.
 */
function renderProgressBar(progress: number): string {
  const p = Math.max(0, Math.min(100, progress)); // clamp 0-100
  const filled = '█'.repeat(Math.floor(p / 10));
  const empty = '░'.repeat(10 - Math.floor(p / 10));
  return `[${filled}${empty}] ${p}%`;
}


// --- BOT COMMAND HANDLERS ---
function registerHandlers(bot: Bot<MyContext>) {
    // 1. /start & /agendar Command
    bot.command(['start', 'agendar'], async (ctx) => {
      const dbClient = ctx.dbClient;
      // Clear session and set initial step
      ctx.waitUntil(updateSession(ctx, dbClient, STEPS.AWAIT_NAME, {}, true));

      await ctx.reply(
        "🔧 *CITA INICIADA*\nPor favor, ingresa tu *nombre completo* para agendar.",
        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
      );
    });

    // 2. /estado Command
    bot.command('estado', async (ctx) => {
      const dbClient = ctx.dbClient;
      const chatId = ctx.chat!.id;

      const dbOperation = dbClient('QUERY_JOBS', { chatId });

      ctx.waitUntil(dbOperation.then(async (jobs: any[]) => {
        if (!jobs || jobs.length === 0) {
          return ctx.api.sendMessage(chatId, "❌ No encontramos vehículos activos a tu nombre. ¿Quizás `/agendar` una cita?");
        }

        const job = jobs[jobs.length - 1]; // Get latest job
        const statusText = job.status.toUpperCase().replace(/_/g, ' ');
        const progressBar = renderProgressBar(job.progress);

        const message = `
    🚗 *ESTADO DE TU VEHÍCULO*
    *Orden ID:* #${job.ID}
    *Cliente:* ${job.client_name}
    *Vehículo:* ${job.vehicle_info}

    *Estatus:* ${statusText}
    *Progreso:* ${progressBar}
    *Notas del Técnico:* ${job.notes || 'En revisión.'}
        `;

        await ctx.api.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }));
    });

    // 3. /cotizar Command
    bot.command('cotizar', async (ctx) => {
      const dbClient = ctx.dbClient;
      const chatId = ctx.chat!.id;
      const clientName = ctx.from!.first_name;
      const staffGroupId = ctx.env.STAFF_GROUP_ID;

      const jobData = {
        chat_id: chatId,
        client_name: clientName,
        vehicle_info: ctx.match || 'Solicitud de cotización',
        status: 'SCHEDULED',
        progress: 0,
        is_lead: true,
      };

      const dbOperation = dbClient('SAVE_JOB', { jobData });
      
      ctx.waitUntil(dbOperation.then(async (result: any) => {
        const leadMessage = `🚨 *NUEVO LEAD DE COTIZACIÓN* 🚨\n*Cliente:* ${clientName} (Chat ID: ${chatId})\n*Problema:* ${jobData.vehicle_info}\n\n*PROMESA:* Llamada humana en 30 minutos.`;
        if (staffGroupId) {
            await ctx.api.sendMessage(staffGroupId, leadMessage, { parse_mode: 'Markdown' });
        }
      }));
      
      await ctx.reply(
        "📝 Gracias. Un técnico humano le llamará en los próximos 30 minutos para la cotización. *Costo Cero* en la espera."
      );
    });

    // 4. Input Handler (State Machine)
    bot.on('message:text', async (ctx) => {
      const dbClient = ctx.dbClient;
      const userId = ctx.from!.id;
      const input = ctx.message.text.trim();

      // Retrieve Current State
      const session = await dbClient('READ_SESSION', { userId });
      let step = session.current_step || STEPS.IDLE;
      let tempData = session.temp_data || {};

      let nextStep = step;
      let replyText = "";
      let action: 'next' | 'finalize' | 'error' = 'error';

      // --- LOGIC SWITCH ---
      switch (step) {
        case STEPS.AWAIT_NAME:
          if (input.length < 3) {
            replyText = "Nombre muy corto. Ingresa tu nombre completo.";
          } else {
            tempData.client_name = input;
            nextStep = STEPS.AWAIT_VEHICLE;
            replyText = "✅ Nombre registrado. ¿Qué *marca, modelo y año* es el vehículo?";
            action = 'next';
          }
          break;

        case STEPS.AWAIT_VEHICLE:
          if (input.length < 3) {
            replyText = "Sé más específico (ej: 'Toyota Corolla 2015').";
          } else {
            tempData.vehicle_info = input;
            nextStep = STEPS.AWAIT_DESC;
            replyText = "✅ Vehículo registrado. *Describe el problema* (ej: 'ruido en el motor').";
            action = 'next';
          }
          break;

        case STEPS.AWAIT_DESC:
          if (input.length < 5) {
            replyText = "Danos más detalles del problema.";
          } else {
            tempData.vehicle_info += `, ${input}`;
            
            // Finalize Data
            const jobData = {
              chat_id: ctx.chat!.id,
              client_name: tempData.client_name,
              vehicle_info: tempData.vehicle_info,
              status: 'SCHEDULED',
              progress: 0,
              is_lead: false,
            };

            // Async save
            const dbOperation = dbClient('SAVE_JOB', { jobData });
            
            ctx.waitUntil(dbOperation.then(async (result: any) => {
              const staffMessage = `📝 *NUEVA CITA AGENDADA* (ID: #${result.jobId})\n*Cliente:* ${jobData.client_name}\n*Vehículo:* ${jobData.vehicle_info}`;
              // Clear session
              updateSession(ctx, dbClient, STEPS.IDLE, {}, true); 
              // Notify staff
              if (ctx.env.STAFF_GROUP_ID) {
                await ctx.api.sendMessage(ctx.env.STAFF_GROUP_ID, staffMessage, { parse_mode: 'Markdown' });
              }
            }));

            nextStep = STEPS.IDLE;
            replyText = `✅ ¡Cita Confirmada, ${tempData.client_name}! Te notificaremos cambios.`;
            action = 'finalize';
          }
          break;

        case STEPS.IDLE:
        default:
          if (!input.startsWith('/')) {
             // Ignore random text in IDLE to avoid spam, or give a hint
             replyText = "Usa /agendar para una cita o /cotizar para precios.";
          }
          break;
      }
      
      // --- EXECUTION ---
      if (action === 'next') {
          ctx.waitUntil(updateSession(ctx, dbClient, nextStep, tempData, false));
      } else if (action === 'finalize') {
          // Session clearing is handled in the waitUntil block above to ensure Order ID is generated first if needed, 
          // but for speed we already triggered the clear inside the promise. 
          // We do nothing here regarding session to avoid race conditions.
      }

      if (replyText) {
        await ctx.reply(replyText, { parse_mode: 'Markdown' });
      }
    });
}

// --- CLOUDFLARE WORKER ENTRY POINT ---
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

    const callback = webhookCallback(bot, 'cloudflare-mod');
    return callback(request);
  },
};