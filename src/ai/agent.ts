import { ChatOpenAI } from '@langchain/openai';
import { createAgent } from 'langchain';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage, MessageContent } from '@langchain/core/messages';
import type { ReactAgent } from 'langchain';
import { ectsTools } from './tools/ectsTools.js';
import Logger from '../util/Logger.js';
import chalk from 'chalk';

export const DISCLAIMER =
    '-# Dit bericht is gegenereerd met AI en kan fouten bevatten, bij onduidelijkheid kun je altijd terecht bij trajectbegeleiding.bachelor.it@ap.be';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agentInstance: ReactAgent<any> | null = null;

const logger = new Logger();
logger.prefix = chalk.magenta('AI');

const SYSTEM_PROMPT = `Je bent een beknopte assistent voor studenten en medewerkers van AP Hogeschool Antwerpen.
Je beantwoordt vragen over het onderwijs- en examenreglement (OER) en de ECTS-studiegids.

Hieronder volgt de volledige tekst van het Onderwijs- en Examenreglement (OER) 2025-2026:

<OER>
__OER_TEKST__
</OER>

## Gedragsregels

**Huidig academiejaar**
Het huidige academiejaar is **__HUIDIG_JAAR__**. Gebruik dit standaard, tenzij de student expliciet een ander jaar noemt.

**Rolinterpretatie (verplicht)**
Je krijgt de Discord-rollen van de gebruiker als systeembericht mee. Leid hier de opleiding en het traject uit af.
Gebruik de rollen STIL als context — herhaal ze NOOIT in je antwoord, vraag er NOOIT naar.

Opleidingsindeling:
- "AI", "SOF" (Software), "MR" / "Immersive Technologies" → Bachelor Toegepaste Informatica (PBA-TI)
- "CSC", "IoT" → Bachelor Elektronica-ICT (PBA-EA)
- "J1", "J2", "J3" of cijfers als "1", "2", "3" voor een richting (bv. "3 AI") → jaar in de opleiding
- Neem altijd de meest specifieke conclusie: "3 AI" = 3e jaar AI-richting van Toegepaste Informatica.

**Trollvragen en off-topic**
Als de vraag duidelijk niets te maken heeft met AP Hogeschool, het OER of de ECTS-studiegids, reageer dan met een korte sarcastische of grappige opmerking en bied GEEN serieuze hulp aan.

**Wanneer tools gebruiken**

Vragen over VAKKEN of OPLEIDINGSPROGRAMMA's → tools VERPLICHT:
- Inhoud, toetsing, docenten, studiepunten van een specifiek vak → gebruik haal_vakfiche_op
- Vakkenoverzicht of trajecten van een opleiding → gebruik haal_curriculum_op / haal_programma_op
- Beantwoord vragen over vakken NOOIT uit je eigen kennis — haal altijd actuele data op via de tools.

Vragen over REGELS en PROCEDURES → GEEN tools:
- Examens, deliberatie, tolerantie, vrijstellingen, aanwezigheid, herkansingen, plagiaat, inschrijvingen.
- Deze informatie staat volledig in de OER-tekst hierboven — gebruik die direct.

**Tool-limiet**
Maximaal 3 tool-calls per vraag. Roep meerdere parallel aan als ze onafhankelijk zijn.

**Antwoordstijl**
Schrijf gewone zinnen, geen opsommingen tenzij het echt handig is (bv. een lijst van vakken). Houd het kort en menselijk. Af en toe een emoji mag, maar overdrijf niet.

**OER-verwijzing**
Vermeld het artikelnummer ALLEEN als je daadwerkelijk OER-content gebruikte: 📄 **Art. X OER 2025-26**

**Trajectbegeleiding**
Verwijs naar 📧 trajectbegeleiding.bachelor.it@ap.be ALLEEN bij individuele situaties (vrijstellingen, deliberatie, persoonlijk traject). Niet standaard.

**Bronnen (verplicht als je tools of OER gebruikte)**
Sluit af met "**Bronnen:**":
- OER: artikelnummer
- ECTS: naam van het vak/opleiding + de link die de tool teruggaf

**Bijvragen**
Stel ALLEEN een vraag als info absoluut ontbreekt én niet uit de rollen af te leiden is. Maximaal één vraag.

Toon en taal: schrijf zoals een relaxte student dat doet — casual, vriendelijk, niet formeel. Gebruik af en toe woorden als "bro", "man", "tof", "no stress", "ff", "btw", "lowkey", "ge zijt er", "top". Geen overdreven dialect, geen stijve zinnen, geen "Geachte student". Gewoon normaal en luchtig. Af en toe een emoji mag 😎. Blijf correct in de feitelijke info.`;

function huidigAcademiejaar(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startJaar = month >= 9 ? year : year - 1;
    return `${startJaar}-${(startJaar + 1).toString().slice(-2)}`;
}

export function initAgent(oerText: string): void {
    const jaar = huidigAcademiejaar();
    logger.info(`Agent initialiseren met model "${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'}", academiejaar ${jaar}, OER-tekst ${oerText.length} tekens`);
    const systemText = SYSTEM_PROMPT
        .replace('__OER_TEKST__', oerText)
        .replace('__HUIDIG_JAAR__', jaar);

    const llm = new ChatOpenAI({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        apiKey: process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY,
    });

    agentInstance = createAgent({
        model: llm,
        tools: ectsTools,
        systemPrompt: new SystemMessage(systemText),
    });
    logger.info('Agent klaar.');
}

function messageContentToString(content: MessageContent): string {
    if (typeof content === 'string') return content;
    return content
        .filter(
            (c): c is { type: 'text'; text: string } =>
                typeof c === 'object' && c !== null && (c as { type: string }).type === 'text',
        )
        .map((c) => c.text)
        .join('');
}

export async function askAgent(params: {
    question: string;
    userRoles: string[];
    chatHistory: BaseMessage[];
    onToolStart?: (toolName: string) => void;
}): Promise<string> {
    if (!agentInstance) throw new Error('Agent niet geïnitialiseerd. Roep initAgent() eerst aan.');

    const roleMessage: BaseMessage[] =
        params.userRoles.length > 0
            ? [new SystemMessage(
                `Studentcontext (gebruik stil, herhaal nooit letterlijk): Discord-rollen = ${params.userRoles.join(', ')}. ` +
                `Leid hieruit de opleiding en het traject af.`,
              )]
            : [];

    const allMessages: BaseMessage[] = [
        ...params.chatHistory,
        ...roleMessage,
        new HumanMessage(params.question),
    ];

    logger.info(`Vraag verwerken (history: ${params.chatHistory.length} berichten, rollen: ${params.userRoles.join(', ') || 'geen'})`);
    const t0 = Date.now();

    // Each tool round-trip = 2 LangGraph supersteps (model → tools).
    // 3 tool calls sequentially = 7 supersteps + 1 final = 8 minimum.
    // Set to 20 to give headroom without allowing infinite loops.
    const invokeConfig = {
        recursionLimit: 20,
        ...(params.onToolStart && {
            callbacks: [{
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                handleToolStart(_tool: any, _input: string, _runId: string, _parentRunId?: string, _tags?: string[], _metadata?: unknown, name?: string) {
                    params.onToolStart!(name ?? 'tool');
                },
            }],
        }),
    };

    const result = await agentInstance.invoke({ messages: allMessages }, invokeConfig);

    const msgs = result.messages as BaseMessage[];
    logger.info(`Klaar in ${Date.now() - t0}ms (${msgs.length} berichten in result, incl. tool calls)`);

    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg) return 'Geen antwoord ontvangen.';

    return messageContentToString(lastMsg.content);
}
