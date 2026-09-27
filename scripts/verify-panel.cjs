// Render the authored side panel in an isolated Electron window with a fixture
// chrome API. No user's browser/profile or live webpage is accessed.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, unlinkSync } = require('node:fs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')
app.disableHardwareAcceleration()
const timer = setTimeout(() => app.exit(1), 20000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 440, height: 1150, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const fixture = { overview: 'Thiel weighs the risks of AI against the political risks of stagnation. He argues that slowing progress is itself a consequential choice, rather than a neutral baseline.',
    takeaways: [{ text: 'Thiel argues that stagnation can destabilize society when younger generations lose the expectation of a better future.', sources: [1] },
      { text: 'A worldwide AI slowdown could require coercive enforcement, creating another risk through concentrated political power.', sources: [2] }], connections: '', ideas: [
    { title: 'Stagnation also carries political risks', claim: 'A society without progress can become unstable as younger generations lose confidence in the future.', reasoning: 'He connects expectations of intergenerational improvement with a functioning middle-class society.', example: 'He challenges the assumption that zero growth would leave a peaceful social democracy.', caveat: 'He accepts AI risk for the sake of argument; he does not establish a probability.', sources: [1] },
    { title: 'Enforcing a global slowdown could concentrate power', claim: 'Effective global coordination could require a world government with coercive power.', reasoning: 'He worries that the enforcement mechanism could become worse than the risk it addresses.', example: '', caveat: '', sources: [2] }
  ], evaluation: [{ claim: 'Slowing AI also has costs', support: 'He proposes a mechanism connecting lost progress to instability.', limits: 'That does not compare the effects of a targeted slowdown with stopping all progress.', test: 'Examine whether a specific precaution would preserve other sources of growth.', sources: [1] }],
    unanswered: ['Which specific safety measures would he support?'], model: 'Fixture model', sections: 1 }
  const transcript = { videoId: 'B7yl7fEHeKM', title: 'Peter Thiel: The AI Crisis, Europe’s Decline & the Battle for America', language: 'en', automatic: true, duration: 3921, source: 'caption-track', complete: true, segments: [ { start: 327, duration: 40, text: 'It does not necessarily follow that you should always go slower. If there is no progress, I do not think our societies work at all.' }, { start: 445, duration: 30, text: 'I think that would require a one world government with real teeth, real force.' } ] }
  const html = readFileSync('out/extension/sidepanel.html', 'utf8').replace(/<script type="module"[^>]*><\/script>/, '')
  writeFileSync('out/extension/preview.html', html)
  await win.loadFile(resolve('out/extension/preview.html'))
  await win.webContents.executeJavaScript(`
    window.fixtureState = {
      mode: 'success', requests: [], modelMs: 180, captureMs: 90, pingMs: 60, cacheClearFails: false, copyFails: false, copied: '',
      transcript: ${JSON.stringify(transcript)}, analysis: ${JSON.stringify(fixture)},
      stored: {'target:1': {tabId:2,windowId:1,videoId:'B7yl7fEHeKM',title:${JSON.stringify(transcript.title)},start:true,token:'fixture',clickedAt:performance.timeOrigin+performance.now()-600}}
    };
    const state = window.fixtureState;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
      if (state.copyFails) throw new Error('Fixture clipboard failure');
      state.copied = text;
    } } });
    window.chrome = {
      windows: { getCurrent: async () => ({id:1}) },
      storage: { session: {
        get: async () => state.stored,
        set: async values => { Object.assign(state.stored, values) }
      }, onChanged: { addListener: f => state.onChange = f } },
      tabs: { query: async () => [] },
      scripting: { executeScript: async () => {
        const snapshot = {...state.transcript};
        await new Promise(resolve => setTimeout(resolve, state.captureMs));
        return [{result:{transcript:snapshot}}];
      } },
      runtime: { connectNative: () => {
        let listener, onDisconnect, timer;
        return {
          onMessage: {addListener: f => listener=f}, onDisconnect: {addListener: f => onDisconnect=f},
          disconnect: () => {clearTimeout(timer);onDisconnect?.()},
          postMessage: r => {
            state.requests.push(r);
            const cached = r.action === 'analyze' && state.mode === 'cache' && !r.fresh;
            timer = setTimeout(() => {
              if (r.action === 'analyze' && state.mode === 'failure') {listener({id:r.id,type:'error',message:'Fixture provider failure'});return}
              if (r.action === 'clear-cache' && state.cacheClearFails) {listener({id:r.id,type:'error',message:'Fixture cache access failure'});return}
              let result = r.action === 'ping' ? {model:'Fixture model'} : state.analysis;
              if (r.action === 'clear-cache') {result={cleared:2,failed:0};state.mode='success'}
              if (r.action === 'translate') result = {...result,overview:'蒂尔认为，人工智能的风险需要与停滞带来的政治风险一起衡量。',takeaways:result.takeaways.map(x=>({...x,text:'停滞也有风险。'})),ideas:result.ideas.map(x=>({...x,title:'停滞也带来政治风险'})),evaluation:result.evaluation.map(x=>({...x,claim:'检验这个观点',support:'提出了一个机制。',limits:'还没有比较两种选择。',test:''}))};
              if (r.action === 'question') result = {answer:'He sees stagnation as another source of risk.',sources:[1]};
              listener({id:r.id,type:'result',result,cached,timing:r.action === 'analyze' ? {modelMs:cached?0:state.modelMs} : undefined});
            }, r.action === 'ping' ? state.pingMs : r.action === 'analyze' && !cached ? state.modelMs + 70 : 20);
          }
        };
      } }
    };
    state.navigate = (videoId, start=true, token=crypto.randomUUID()) => {
      state.transcript = {...state.transcript,videoId};
      const next = {...state.stored['target:1'],videoId,start,token,clickedAt:performance.timeOrigin+performance.now()};
      state.stored['target:1'] = next;
      state.onChange({'target:1':{newValue:next}},'session');
    };
    void 0
  `)
  const script = readFileSync('out/extension/sidepanel.js', 'utf8')
  await win.webContents.executeJavaScript(`(async()=>{${script}\n})()`)
  const read = code => win.webContents.executeJavaScript(code)
  const waitFor = async condition => {
    for (let i=0;i<100;i++) {
      if (await read(condition)) return;
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error(`Panel condition timed out: ${condition}`)
  }
  const finished = () => waitFor('!document.getElementById("understand").disabled')
  const total = () => read('document.getElementById("timing-total").textContent')
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Elapsed')
  assert.equal(await read('document.getElementById("timing-source").hidden'), true, 'does not guess the source while waiting')
  assert.equal(await read('document.getElementById("clear-cache").disabled'), true, 'cache clearing cannot interrupt a summary')
  assert.ok(parseFloat(await total()) >= 0.6, 'includes time before the panel starts')
  await waitFor('fixtureState.requests.at(-1)?.action === "analyze"')
  const capturedSize = await read('document.getElementById("transcript-size").textContent')
  assert.match(capturedSize, /^Captured 39 words · ≈[\d,]+ tokens \(estimated\)$/, 'counts the caption words, not the title or summary')
  assert.equal(await read('document.getElementById("transcript-size").hidden'), false, 'input size appears before the model finishes')
  await finished()
  assert.equal(await read('document.getElementById("transcript-size").textContent'), capturedSize)
  assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("details.idea").length'), 2)
  assert.equal(await win.webContents.executeJavaScript('document.getElementById("overview-card").hidden'), false)
  assert.equal(await win.webContents.executeJavaScript('document.getElementById("ideas-section").open'), false)
  assert.equal(await read('document.querySelectorAll("#takeaways > li").length'), 2)
  assert.equal(await read('document.getElementById("connections-details").hidden'), true)
  assert.equal(await read('document.querySelectorAll(".evidence[open]").length'), 0, 'source quotes start collapsed')
  assert.equal(await read('getComputedStyle(document.getElementById("overview")).fontSize'), '18px')
  assert.equal(await read('getComputedStyle(document.querySelector(".claim")).fontSize'), '18px')
  assert.equal(await read('document.getElementById("evaluation-section").hidden'), false)
  assert.equal(await read('document.getElementById("evaluation-section").open'), false, 'critical assessment starts collapsed')
  assert.equal(await read('document.querySelectorAll("#evaluation .assessment").length'), 1)
  assert.equal(await read('document.getElementById("overview-card").textContent.includes("targeted slowdown")'), false, 'model criticism is separate from the speaker summary')
  await read('document.getElementById("copy-summary").click()')
  await waitFor('document.getElementById("copy-status").textContent.startsWith("Copied")')
  const copied = await read('fixtureState.copied')
  assert.match(copied, /## Key takeaways/)
  assert.match(copied, /Enforcing a global slowdown could concentrate power/)
  assert.match(copied, /world government with coercive power/)
  assert.match(copied, /&t=445s/)
  assert.match(copied, /## Critical assessment/)
  assert.match(copied, /targeted slowdown/)
  assert.match(copied, /External facts have not been checked/)
  await read('fixtureState.copyFails=true;document.getElementById("copy-summary").click()')
  await waitFor('document.getElementById("copy-status").textContent.startsWith("Could not copy")')
  await read('fixtureState.copyFails=false;document.getElementById("copy-status").textContent=""')
  const firstTotal = await total()
  assert.ok(parseFloat(firstTotal) >= 0.93, 'total includes opening, ping, collection and model')
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Click → summary ready')
  assert.equal(await read('document.getElementById("timing-request").textContent'), '0.180 s')
  const freshSource = 'Fresh model response · 0.180 s model time'
  assert.equal(await read('document.getElementById("timing-source").textContent'), freshSource)
  assert.equal(await read('document.getElementById("timing").open'), false)
  assert.equal(await read('document.getElementById("timing-source").getBoundingClientRect().height > 0'), true, 'origin is visible without opening timing details')
  const transcriptTime = parseFloat(await read('document.getElementById("timing-transcript").textContent'))
  const otherTime = parseFloat(await read('document.getElementById("timing-other").textContent'))
  assert.ok(transcriptTime >= 0.08, 'caption loading is separately measured')
  assert.ok(Math.abs(parseFloat(firstTotal) - transcriptTime - 0.18 - otherTime) <= 0.002, 'breakdown accounts for total')
  assert.equal(await read('document.getElementById("understand").textContent'), 'Summarize again')
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  mkdirSync('out/verification', { recursive: true })
  writeFileSync('out/verification/panel-english.png', (await win.webContents.capturePage()).toPNG())
  await read('document.getElementById("timing").open=true; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync('out/verification/panel-timing.png', (await win.webContents.capturePage()).toPNG())
  await read('document.getElementById("timing").open=false')
  await win.webContents.executeJavaScript('document.getElementById("ideas-section").open=true; document.querySelector("details.idea").open=true; document.getElementById("ideas-section").scrollIntoView(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync('out/verification/panel-breakdown.png', (await win.webContents.capturePage()).toPNG())
  win.setSize(360, 1000)
  await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth'), true, 'large reading text fits a narrow panel')
  writeFileSync('out/verification/panel-breakdown-narrow.png', (await win.webContents.capturePage()).toPNG())
  await read('document.getElementById("evaluation-section").open=true;document.getElementById("evaluation-section").scrollIntoView();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth'), true, 'critical assessment fits a narrow panel')
  writeFileSync('out/verification/panel-evaluation.png', (await win.webContents.capturePage()).toPNG())
  win.setSize(440, 1150)
  await win.webContents.executeJavaScript('document.getElementById("chinese").click()')
  await finished()
  assert.match(await win.webContents.executeJavaScript('document.getElementById("overview").textContent'), /蒂尔/)
  await read('document.getElementById("copy-summary").click()')
  await waitFor('fixtureState.copied.includes("核心") || fixtureState.copied.includes("蒂尔")')
  assert.match(await read('fixtureState.copied'), /停滞也有风险。/)
  assert.match(await read('fixtureState.copied'), /检验这个观点/)
  assert.equal(await read('document.querySelectorAll("#evaluation .detail-text").length'), 2, 'empty proposed checks are omitted')
  await win.webContents.executeJavaScript('document.getElementById("english").click(); document.getElementById("question").value="What is his reasoning?";document.getElementById("question-form").requestSubmit()')
  await finished()
  assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#conversation .answer").length'), 1)
  assert.equal(await total(), firstTotal, 'translation and questions do not overwrite summary time')
  assert.equal(await read('document.getElementById("timing-source").textContent'), freshSource, 'origin remains attached to the original summary timing')
  assert.equal(await read('document.getElementById("transcript-size").textContent'), capturedSize, 'translation and questions retain captured input counts')

  await read('fixtureState.mode="cache";fixtureState.navigate("jNQXAC9IVRw")')
  await finished()
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Saved summary loaded')
  assert.equal(await read('document.getElementById("timing-request").textContent'), 'Not called (cached)')
  assert.equal(await read('document.getElementById("timing-source").textContent'), 'Cached summary · No model call')
  assert.equal(await read('document.getElementById("timing-source").getBoundingClientRect().height > 0'), true)
  await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync('out/verification/panel-cached.png', (await win.webContents.capturePage()).toPNG())
  assert.equal(await read('document.getElementById("transcript-size").textContent'), capturedSize, 'cached summaries show current transcript counts')
  await read('document.getElementById("understand").click()')
  assert.equal(await read('document.getElementById("timing-source").hidden'), true, 'rerun clears previous cache origin')
  assert.equal(await read('document.getElementById("transcript-size").hidden'), true, 'recapture clears old counts until captions load')
  await finished()
  assert.equal(await read('fixtureState.requests.at(-1).fresh'), true, 'rerun bypasses saved summary')
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Click → summary ready')
  assert.equal(await read('document.getElementById("timing-source").textContent'), freshSource, 'rerun reports a fresh model response')

  const beforeClear = await read('fixtureState.requests.length')
  await read('fixtureState.cacheClearFails=true;document.getElementById("clear-cache").click()')
  await finished()
  assert.match(await read('document.getElementById("status").textContent'), /Could not confirm/)
  assert.equal(await read('document.getElementById("overview-card").hidden'), false, 'failed clear retains displayed summary')
  await read('fixtureState.cacheClearFails=false;document.getElementById("clear-cache").click()')
  await finished()
  assert.equal(await read('fixtureState.requests.length'), beforeClear + 2, 'clearing makes no analysis, translation or ping calls')
  assert.equal(await read('fixtureState.requests.at(-1).action'), 'clear-cache')
  assert.match(await read('document.getElementById("status").textContent'), /Cache cleared.*2 saved entries/)
  assert.equal(await read('document.getElementById("overview-card").hidden'), true)
  assert.equal(await read('document.getElementById("evaluation-section").hidden'), true)
  assert.equal(await read('document.getElementById("evaluation").childElementCount'), 0)
  assert.equal(await read('document.getElementById("timing").hidden'), true)
  assert.equal(await read('document.getElementById("languages").hidden'), true, 'cannot translate a removed cached analysis')
  assert.equal(await read('document.getElementById("clear-cache").disabled'), false)
  await read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  writeFileSync('out/verification/panel-cache-cleared.png', (await win.webContents.capturePage()).toPNG())
  await read('document.getElementById("understand").click()')
  await finished()
  assert.equal(await read('document.getElementById("timing-source").textContent'), freshSource, 'next summary is generated afresh')

  await read('fixtureState.mode="failure";document.getElementById("understand").click()')
  await finished()
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Failed after')
  assert.equal(await read('document.getElementById("timing-source").hidden'), true)
  const failedTotal = await total()
  await new Promise(r => setTimeout(r, 150))
  assert.equal(await total(), failedTotal, 'failure freezes timer')

  await read('fixtureState.mode="success";fixtureState.modelMs=1000;fixtureState.requests=[];document.getElementById("understand").click()')
  await waitFor('fixtureState.requests.at(-1)?.action === "analyze"')
  await read('document.getElementById("cancel").click()')
  assert.equal(await read('document.getElementById("timing-label").textContent'), 'Cancelled after')
  assert.equal(await read('document.getElementById("timing-source").hidden'), true)
  const cancelledTotal = await total()
  await new Promise(r => setTimeout(r, 150))
  assert.equal(await total(), cancelledTotal, 'cancellation freezes timer')
  await read('fixtureState.navigate("B7yl7fEHeKM",false)')
  assert.equal(await read('document.getElementById("timing").hidden'), true, 'navigation clears previous timing')
  assert.equal(await read('document.getElementById("transcript-size").hidden'), true, 'navigation clears previous input counts')

  // Reopening a panel must not reuse a consumed click or silently restart work.
  const consumed = await read('({...fixtureState.stored["target:1"],start:true,token:fixtureState.stored["started:1"]})')
  await read(`fixtureState.onChange({'target:1':{newValue:${JSON.stringify(consumed)}}},'session')`)
  assert.equal(await read('document.getElementById("timing").hidden'), true)
  console.log('Summary, breakdown, separate critical assessment, 18px/narrow layout, full/translated copy, and existing timing/cache/cancel flows passed.')
  unlinkSync(resolve('out/extension/preview.html'))
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1) })
