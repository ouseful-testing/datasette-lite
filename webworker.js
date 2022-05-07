importScripts("https://cdn.jsdelivr.net/pyodide/dev/full/pyodide.js");

function log(line) {
  console.log({line})
  self.postMessage({type: 'log', line: line});
}

async function startDatasette(initialUrl) {
  let toLoad = [];
  if (initialUrl) {
    let name = initialUrl.split('.db')[0].split('/').slice(-1)[0];
    toLoad.push([name, initialUrl]);
  } else {
    toLoad.push(["fixtures.db", "https://latest.datasette.io/fixtures.db"]);
    toLoad.push(["content.db", "https://datasette.io/content.db"]);
  }
  console.log({toLoad});
  self.pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/dev/full/"
  });
  await pyodide.loadPackage('micropip', log);
  await pyodide.loadPackage('ssl', log);
  await pyodide.loadPackage('setuptools', log); // For pkg_resources
  try {
    await self.pyodide.runPythonAsync(`
    # Grab that fixtures.db database
    from pyodide.http import pyfetch
    names = []
    for name, url in ${JSON.stringify(toLoad)}:
        response = await pyfetch(url)
        with open(name, "wb") as fp:
            fp.write(await response.bytes())
        names.append(name)

    import micropip
    # Workaround for Requested 'h11<0.13,>=0.11', but h11==0.13.0 is already installed
    await micropip.install("h11==0.12.0")
    await micropip.install("datasette==0.62a0")
    
    with open("metadata.json", "w") as f:
      f.write('{"title": "Custom metadata title", "description": "Custom metadata description"}')
    
    from pathlib import Path
    Path('./templates/pages').mkdir(parents=True, exist_ok=True)
    with open('templates/pages/demo.html', 'w') as f:
      f.write('<html><head><title>Demo<</title></head><body><h1>Test</h1></body></html>')

    from datasette.app import Datasette
    ds = Datasette(names, settings={
        "num_sql_threads": 0,
    }, metadata = {
        "about": "Datasette Lite",
        "about_url": "https://github.com/simonw/datasette-lite"
    })
    `);
    datasetteLiteReady();
  } catch (error) {
    self.postMessage({error: error.message});
  }
}

// Outside promise pattern
// https://github.com/simonw/datasette-lite/issues/25#issuecomment-1116948381
let datasetteLiteReady;
let readyPromise = new Promise(function(resolve) {
  datasetteLiteReady = resolve;
});

self.onmessage = async (event) => {
  console.log({event, data: event.data});
  if (event.data.type == 'startup') {
    await startDatasette(event.data.initialUrl);
    return;
  }
  // make sure loading is done
  await readyPromise;
  console.log(event, event.data);
  try {
    let [status, contentType, text] = await self.pyodide.runPythonAsync(
      `
      import json
      response = await ds.client.get(
          ${JSON.stringify(event.data.path)},
          follow_redirects=True
      )
      [response.status_code, response.headers.get("content-type"), response.text]
      `
    );
    self.postMessage({status, contentType, text});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
