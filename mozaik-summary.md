# Mozaik Network + Mozaik Agent — summary za stockmind-ai

Nov 27, 2026 · @Nenad

## Šta je bitno, a lako se previdi

Ovih devet stvari se ne vide na prvi pogled u kodu, a od njih zavisi da li će sistem raditi. Svaka je objašnjena u svom delu ispod.

1. **Mozaik sam ne šalje `agent.instruction` i `agent.tools` modelu.** Ti ih stavljaš u inference step.
2. **"instruction" znači dve stvari:** system prompt agenta (`Agent.instruction`) i step u loop-u (`setBreakpoint({ instruction })`).
3. **Breakpoint je mesto za ljudsko odobrenje** unutar jednog task-a.
4. **Model ne pamti ništa.** Svaki request nosi ceo context, i svaki `tool_call` mora dobiti svoj `tool_call_result`.
5. **Petlju koja vozi loop pišeš ti.** Mozaik ne odlučuje koji je sledeći step.
6. **Jedan tool registry za sve agente**, pa imena tool-ova moraju biti jedinstvena.
7. **Osnove Network-a:** peer, token, invite link kao tajna, naplata po poruci.
8. **Rizici:** agenti koji se dopisuju u krug, izgubljene `to` poruke, loop-ovi koji nestaju posle restarta, lažno odobrenje.
9. **Imena i verzije paketa nisu provereni** na npm-u.

## Model i agent

Model je jedan API poziv, a agent je tvoj kod oko modela.

- **Model** dobije context i `tools`, a vrati tekst (`model_message`) ili `tool_call`. Ništa ne izvršava i ništa ne pamti između poziva.
- **Agent** je `instruction` (system prompt) + `tools` (tool definitions) + loop koji ga vozi.

Agenta praviš sa `createAgent({ name, instruction, tools })` iz `resolveAgentModule()`, jednom po agentu: šest puta za vaš sistem. Klasu `Agent` (`src/agent/domain/agent/agent.ts`) ne instanciraš direktno. Svi agenti mogu koristiti isti model; razlikuju se po `instruction` i `tools`.

## Šta ide u request modelu

Svaki request nosi četiri stvari, i sve četiri sastavlja tvoj kod.

| Deo requesta | Odakle dolazi | Šta model iz njega zna |
| --- | --- | --- |
| `system_message` | `agent.instruction` | ko je i kako radi |
| `user_message` | `loop.goal` | koji task treba da završi |
| `tools` | `agent.tools` | koje tool-ove sme da zatraži i sa kojim argumentima |
| `model_message`, `tool_call`, `tool_call_result` | prethodni step-ovi istog loop-a | šta je već uradio i šta su tool-ovi vratili |

Mozaik ništa od ovoga ne dodaje sam: context praviš ti, a u inference step prosleđuješ `tools: agent.tools`. Fajl `request-validation/context.ts` samo proverava da li model podržava svaku vrstu context item-a (`supportedContextItemTypes`).

## Tool

Tool ima dva dela: definition koju vidi model i implementaciju koja radi u tvom Node procesu.

- **Tool definition** (`name`, `description`, `parameters`, `strict`) ide modelu u svakom requestu.
- **Implementaciju** registruješ sa `registerTool(name, { invoke })` pod istim `name`.
- Model nikad ne pokreće metodu, samo je **zatraži** preko `tool_call`. Step `tool_call` onda uradi `getTool`, pa `JSON.parse(toolArguments)`, pa `invoke`.
- `description` je jedino što model zna o tool-u. Od njega zavisi da li će ga izabrati.
- `strict: true` i JSON Schema teraju model da pošalje ispravne argumente.
- Ako tool baci grešku, model dobije tekst `"Error calling tool: ..."`.
- Postoji jedan registry za sve agente, pa su imena jedinstvena, npr. `nabavka_uporedi_kolicine`. Agent može da koristi samo tool-ove čije definicije mu pošalješ.
- Brojeve računa i poredi kod u tool-u, a ne model. Tako svaki broj ima izvor (fajl:red).

Primer tool-a za agenta za nabavku:

```ts
// 1) definition: ovo vidi model
const uporediKolicineDef: ToolDefinition = {
  name: "uporedi_kolicine",
  description: "Uporedi količine sa fakture i prijemnice. Vraća stavke koje se razlikuju, sa izvorom (fajl:red).",
  parameters: {
    type: "object",
    properties: { fakturaId: { type: "string" }, prijemnicaId: { type: "string" } },
    required: ["fakturaId", "prijemnicaId"],
    additionalProperties: false,
  },
  strict: true,
}

// 2) implementacija: ovo radi tvoj Node proces
registerTool("uporedi_kolicine", {
  invoke: ({ fakturaId, prijemnicaId }) => {
    const faktura = fakture[fakturaId as string]
    const prijemnica = prijemnice[prijemnicaId as string]
    if (!faktura || !prijemnica) throw new Error("Nepoznata faktura ili prijemnica")
    return faktura.stavke.flatMap((f) => {
      const p = prijemnica.stavke.find((s) => s.artikal === f.artikal)
      if (p && p.kolicina === f.kolicina) return []
      return [{
        artikal: f.artikal,
        faktura: f.kolicina,
        prijemnica: p?.kolicina ?? 0,
        izvor: `${faktura.fajl}:${f.red}, ${prijemnica.fajl}:${p?.red ?? "-"}`,
      }]
    })
  },
})
```

## Loop i step-ovi

Loop je jedan task jednog agenta, od `goal`-a do konačnog odgovora: agent se pravi jednom, a loop za svaki task.

Loop čuva:

- `goal` i `assignee`
- `pendingInstruction`: najviše jedan step koji čeka
- `completedInstructions`
- `state`: `idle`, `awaiting_result`, `completed`, `stopped` ili `paused`

Step može biti samo `inference` (pozovi model) ili `tool_call` (pokreni tool). Folder `domain/instruction` definiše step-ove, a `domain/loop` čuva stanje.

Tok jednog loop-a:

1. inference: model dobija ceo context i `tools`
2. model vrati `tool_call`
3. tool\_call step: tvoj kod pokreće `invoke`
4. `tool_call_result` ide u context, sa istim `requestId`
5. ponovo inference, sa celim context-om
6. ... sve dok model ne vrati `model_message`, pa `endLoop`

- Model ne pamti, pa svaki inference nosi ceo context iznova.
- `requestId` povezuje `tool_call` sa njegovim rezultatom. Bez rezultata provider odbija sledeći request.
- Petlju pišeš ti, kao u `examples/run-loop.ts`. Skica (tačne potpise proveriti u tom fajlu):

```ts
const context = [
  { type: "system_message", text: agent.instruction },
  { type: "user_message", text: loop.goal },
]
while (true) {
  setBreakpoint(loop, { instruction: inference(context, agent.tools) })
  const items = await advanceLoop(loop)        // odgovor modela
  context.push(...items)
  const call = items.find((i) => i.type === "tool_call")
  if (!call) { endLoop(loop); break }          // model_message = kraj
  setBreakpoint(loop, { instruction: toolCall(call) })
  const text = await advanceLoop(loop)         // tvoj invoke()
  context.push({ type: "tool_call_result", requestId: call.requestId,
                 result: { type: "input_text", text } })
}
```

## Breakpoint

Breakpoint je mesto gde loop staje dok tvoj kod ne odluči da li se sledeći step izvršava.

- `setBreakpoint({ instruction })` stavi step u `pendingInstruction`. Može biti samo jedan; drugi `setBreakpoint` baca grešku.
- `advanceLoop` izvrši step koji čeka.
- `endLoop` umesto `advanceLoop` znači da step nikad ne bude izvršen.
- Pre `advanceLoop` tvoj kod vidi `tool_call` (ime + argumente) i može da pita čoveka.

Čovek u vašem sistemu učestvuje na dva načina:

1. **Između task-ova**, porukom na mreži: vlasnik potvrđuje količine (`receipt.confirmed`) i prihvata ili odbija preporuke.
2. **Unutar task-a**, na breakpoint-u: pre nego što se pokrene osetljiv tool.

Primeri u repo-u: `examples/approve-tool-call.ts` i `examples/rule-engine/breakpoint-policy.ts`.

## Mozaik Network

Network samo prenosi poruke između peer-ova; ništa ne odlučuje i ne pokreće agente.

- **Peer** je svaki učesnik. Čovek je takođe peer (role `user`), agent ima role `agent`, a postoji i `external`.
- **Identitet** dolazi samo iz tokena koji peer dobije pri ulasku.
- **Invite link je tajna.** Ide u `.env`, nikad u chat ili commit.
- **Mozaik Cloud** daje API key i naplaćuje. Svaka poruka se računa vlasniku mreže (po komentaru u kodu 500 je besplatno, zatim se troši balance).
- Client paket je `@jigjoy/mozaik-network` (`NetworkClient`). `Connection` sam radi reconnect i ponovni join.

Ulazak u mrežu, korak po korak:

1. Invite link iz `.env` pročitaš sa `readInviteLink`.
2. `createPeer({ name, role, capabilities, invite, policy })` pošalje `POST /peers` sa invite-om kao Bearer i dobije **token**.
3. Peer otvori WebSocket i pošalje `peer.join` sa tokenom.
4. Server vrati `peer.welcomed`: mrežu, listu peer-ova i zadnjih 20 poruka.
5. `sendMessage(peer, networkId, message, to?)` šalje poruku svima, ili jednom peer-u preko `to`.

Envelope tipovi koje peer prima: `peer.joined`, `peer.left`, `peer.welcomed`, `message.sent` (message, senderName, `to`) i `error`.

## Orkestracija

Agenti ne pozivaju jedni druge: kad loop završi, tvoj kod pošalje rezultat u mrežu, a rules drugih agenata pokrenu nove loop-ove.

| Deo rule-a | Šta radi |
| --- | --- |
| `condition` | kad rule važi, npr. `kind` je `receipt.confirmed` i pošiljalac je vlasnik |
| `inputResolver` | šta čita iz poruke |
| `command` | šta radi: napravi loop, vozi ga, pošalje rezultat sa `sendMessage` |
| `priority` | koji rule pobeđuje kad važi više njih; manji broj ima prednost |

- Ako nijedan rule ne odgovara, ne dešava se ništa.
- Rules se registruju sa `@Condition`, `@InputResolver` i `@Command` (`@jigjoy/mozaik-rule-engine`). `Peer.receive` pokreće `applyPolicy` na svaki envelope.
- Payload poruke je string, pa šaljete JSON sa poljem `kind`, koje `condition` proverava:

```json
{ "kind": "receipt.confirmed", "receiptId": "..." }
```

## Vaš tok

Svaki korak pokreće poruka sa `kind` poljem, a vlasnik potvrđuje na dva mesta: prijemnicu i preporuke.

1. Vlasnik šalje `document.uploaded`.
2. Document agent šalje `receipt.draft`, a vlasnik ga potvrdi sa `receipt.confirmed`.
3. Na `receipt.confirmed` paralelno kreću Nabavka i Zalihe.
4. Na `sales.imported` kreću Prodaja i profit, kao i Zalihe. Prodaja i profit kreće i na `price.changed` od Nabavke.
5. Zalihe kreću i na `stock.check` (provera rokova).
6. Svi šalju `finding` Auditoru. Auditor šalje `finding.confirmed`, ili `finding.rejected` preko `to` nazad agentu.
7. Advisor šalje `recommendation`, a vlasnik prihvata ili odbija. Okidač za Advisor-a (`advice.requested`) morate sami da potvrdite kao odluku.

| Agent | Šta radi i šta hvata u primeru |
| --- | --- |
| Document agent | čita PDF otpremnice i fakture, izvlači zaglavlje i stavke sa izvorom (fajl + red), pravi nacrt prijemnice; čovek potvrđuje količine |
| Nabavka | poredi fakturu sa prijemnicom i prethodnom cenom; hvata 3 pogrešne količine (kafa 22/20, Sprite 72/48, Jelen 140/120) i Coca-Colu fakturisanu po 79 umesto 72 |
| Zalihe | prati karticu zaliha i rokove; hvata artikle kojima ističe rok (Fanta, IVI, kisela voda) i Schweppes Tonic prodat preko stanja |
| Prodaja i profit | prodaja po normativima, marže, troškovi; hvata pad prodaje Caramel latte-a i pad marže cappuccina zbog poskupljenja kafe i mleka |
| Auditor | svaki broj iz finding-a proverava u izvoru; ako se ne slaže, odbija i vraća agentu |
| Advisor | potvrđene finding-e pretvara u preporuke po prioritetu, uz napomenu "nije finansijski savet" |

Mozaik context items su samo tekst, pa tekst iz PDF-a vadi vaš kod. Preporuka: tool `read_document(fileName)` koji vraća tekst sa brojevima redova.

## Organizacija koda

Svaki peer dobija svoj folder sa tri fajla, a čista logika bez Mozaika ide posebno u `domain/`.

```
src/
  network/       # protocol.ts (vrste poruka), connect.ts (invite iz .env, join)
  peers/
    <agent>/     # rules.ts, agent.ts (loop), tools.ts
    owner/       # čovek: odobrava i potvrđuje
  domain/        # čista logika: poređenja, obračuni, izveštaj
```

- `protocol.ts` drži sve `kind` vrednosti i oblik payload-a na jednom mestu.
- `tools.ts` samo poziva funkcije iz `domain/`, pa logiku možete testirati bez modela.
- Na početku svi peer-ovi mogu raditi u jednom Node procesu.

## Rizici

Najskuplji rizik je da agenti odgovaraju jedni drugima u krug, jer se svaka poruka naplaćuje.

| Rizik | Šta se desi | Šta uraditi |
| --- | --- | --- |
| Agenti se dopisuju u krug | troše plaćene poruke bez kraja | svaki rule vezati za jedan `kind` i jednog pošiljaoca; ručno uključiti `SendLimit` (10 poruka u 60 s) |
| Poruka sa `to` | ne čuva se; ako primalac nije online, izgubljena je | važne poruke slati svima, ili potvrđivati prijem |
| Restart procesa | loop-ovi su po default-u u memoriji i nestaju | proslediti `loopRepository` koji čuva stanje |
| Lažno odobrenje | svako sa invite link-om može da napravi peer-a sa role `user` | odobrenja prihvatati samo od unapred poznatog peer id-a vlasnika |

## Šta nije provereno

Pre kodiranja treba proveriti tri stvari.

- [ ] README Mozaik Agenta kaže `@mozaik-ai/core`, a `package.json` se zove `@jigjoy/mozaik-agent` 0.0.1. stockmind-ai koristi `@mozaik-ai/core` 4.2.0 sa starijim API-jem. Proveriti na npm-u šta je stvarno objavljeno.
- [ ] Proveriti da li su `@jigjoy/mozaik-network` i `@jigjoy/mozaik-rule-engine` na npm-u.
- [ ] Kako čovek piše u mrežu iz Mozaik Cloud UI-ja: Cloud kod nije u ovim folderima.
