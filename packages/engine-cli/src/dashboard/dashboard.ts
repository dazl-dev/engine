function init() {
    fetch('/api/engine/metadata')
        .then((response) => response.json())
        .then((data) => {
            byId('raw-data-content').textContent = JSON.stringify(data, null, 2);
            updateUI(data);
        })
        .catch(uiError);
}

init();

function updateUI(data: any) {
    const features = Object.keys(data.featureEnvironmentsMapping.featureToEnvironments);
    const configs = Object.keys(data.configMapping);
    const openManagers = data.openManagers;
    populateDatalistOptions(configs, 'config-name-list');
    populateFeatureTable(features, data.configMapping);
    populateOpenEnvs(openManagers);
    populatePreviousRuns();
    setupSearch();
    bindActions();
}

function bindActions() {
    const button = byId('analyze-features-btn') as HTMLButtonElement;
    button.onclick = () => {
        button.disabled = true;
        fetch('/api/engine/analyze', { method: 'POST' })
            .then((response) => response.json())
            .then((data) => {
                if (data.error) {
                    uiError(data.error);
                }
            })
            .catch(uiError)
            .finally(() => {
                button.disabled = false;
            });
    };
}

function setupSearch() {
    const input = byId('feature-search') as HTMLInputElement;
    input.value = localStorage.getItem('feature-search') ?? '';
    const onInput = () => {
        const search = input.value;
        localStorage.setItem('feature-search', search);
        const searchReg = new RegExp(search.replace(/(\w)/g, `$1.*?`), 'i');
        const featureTable = byId('feature-table-content').querySelectorAll('tr[data-feature-name]');
        for (const tr of Array.from(featureTable) as Array<HTMLTableRowElement>) {
            const featureName = String(tr.dataset.featureName);
            tr.style.display = featureName.match(searchReg) ? '' : 'none';
        }
    };
    input.oninput = onInput;
    onInput();
}

function populateOpenEnvs(
    openManagers: { featureName: string; configName: string; runtimeArgs: string; port: number; url: string }[],
) {
    const content = byId('open-environments-content');
    content.innerHTML = '';
    openManagers.forEach(({ featureName, configName, runtimeArgs, url }) => {
        const row = el('tr', {}, [
            el('td', {}, [text(featureName)]),
            el('td', {}, [text(configName)]),
            el('td', {}, [el('pre', {}, [text(niceRuntimeArgs(runtimeArgs))])]),
            el('td', {}, [el('a', { href: url, target: '_blank' }, [text(url)])]),
            el('td', {}, [
                el(
                    'button',
                    {
                        onclick() {
                            runEnvironment(this as HTMLButtonElement, featureName, configName, runtimeArgs, true);
                        },
                    },
                    [text('Restart')],
                ),
            ]),
        ]);
        content.appendChild(row);
    });
}

type PreviousRuns = {
    featureName: string;
    configName: string;
    runtimeArgs: string;
}[];

function getFavorites() {
    return JSON.parse(localStorage.getItem('favorites') || '[]') as PreviousRuns;
}

function saveFavorite(featureName: string, configName: string, runtimeArgs: string) {
    const fav = getFavorites();
    const exists = fav.find(
        (f) => f.featureName === featureName && f.configName === configName && f.runtimeArgs === runtimeArgs,
    );
    if (!exists) {
        fav.unshift({ featureName, configName, runtimeArgs });
        localStorage.setItem('favorites', JSON.stringify(fav));
        populatePreviousRuns();
    }
}

function deleteFavorite(featureName: string, configName: string, runtimeArgs: string) {
    const favorites = getFavorites();
    const index = favorites.findIndex(
        (f) => f.featureName === featureName && f.configName === configName && f.runtimeArgs === runtimeArgs,
    );
    if (index >= 0) {
        favorites.splice(index, 1);
        localStorage.setItem('favorites', JSON.stringify(favorites));
        populatePreviousRuns();
    }
}

function populatePreviousRuns() {
    const previousRuns = getFavorites();
    const content = byId('previous-runs-content');
    content.innerHTML = '';
    previousRuns.forEach(({ featureName, configName, runtimeArgs }) => {
        const row = el('tr', {}, [
            el('td', {}, [text(featureName)]),
            el('td', {}, [text(configName)]),
            el('td', {}, [el('pre', {}, [text(niceRuntimeArgs(runtimeArgs))])]),
            el('td', {}, [
                el(
                    'button',
                    {
                        onclick() {
                            runEnvironment(this as HTMLButtonElement, featureName, configName, runtimeArgs, false);
                        },
                    },
                    [text('Run')],
                ),
            ]),
            el('td', {}, [
                el(
                    'button',
                    {
                        onclick() {
                            deleteFavorite(featureName, configName, runtimeArgs);
                        },
                    },
                    [text('Delete')],
                ),
            ]),
        ]);
        content.appendChild(row);
    });
}

function niceRuntimeArgs(runtimeArgs: string): string {
    if (runtimeArgs.trim() === '') {
        return 'None';
    }
    try {
        return JSON.stringify(JSON.parse(runtimeArgs.trim()), null, 2);
    } catch (e) {
        return runtimeArgs + '\n' + String(e);
    }
}

function findMatchingConfigs(configs: Record<string, string[]>, featureName: string) {
    if (featureName in configs) {
        saveConfigName(featureName, featureName);
        return featureName;
    }
    return '';
}

function populateFeatureTable(features: string[], configs: Record<string, string[]>) {
    const featureTable = byId('feature-table-content');
    featureTable.innerHTML = '';
    features.sort().forEach((featureName) => {
        const row = el('tr', { 'data-feature-name': featureName }, [
            el('td', {}, [text(featureName)]),
            el('td', {}, [
                el('input', {
                    placeholder: 'Config name',
                    list: 'config-name-list',
                    value: getSavedConfigName(featureName) || findMatchingConfigs(configs, featureName),
                    onchange() {
                        saveConfigName(featureName, (this as HTMLInputElement).value);
                    },
                }),
            ]),
            el('td', {}, [
                el('input', {
                    placeholder: 'Runtime args (JSON)',
                    value: localStorage.getItem(featureName + ':runtimeArgs') || '',
                    onchange() {
                        const value = (this as HTMLInputElement).value.trim();
                        localStorage.setItem(featureName + ':runtimeArgs', value);
                    },
                }),
            ]),
            el('td', {}, [
                el(
                    'button',
                    {
                        onclick() {
                            runEnvironment(
                                this as HTMLButtonElement,
                                featureName,
                                getSavedConfigName(featureName),
                                localStorage.getItem(featureName + ':runtimeArgs') || '',
                                false,
                            );
                        },
                    },
                    [text('Run')],
                ),
            ]),
        ]);
        featureTable.appendChild(row);
    });
}

function validateRuntimeArgs(runtimeArgs: string) {
    if (runtimeArgs === '') {
        return;
    }
    try {
        JSON.parse(runtimeArgs);
    } catch (e) {
        throw new Error(`Runtime args are not a valid JSON value`, { cause: e });
    }
}

function runEnvironment(
    btn: HTMLButtonElement,
    featureName: string,
    configName: string,
    runtimeArgs: string,
    restart: boolean,
) {
    try {
        validateRuntimeArgs(runtimeArgs);
    } catch (e) {
        uiError(e);
        return;
    }
    btn.disabled = true;
    saveFavorite(featureName, configName, runtimeArgs);
    fetch('/api/engine/run', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            featureName,
            configName,
            runtimeArgs,
        }),
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.error) {
                throw new Error(data.error);
            }
            populateOpenEnvs(data.openManagers);
            if (!restart) {
                window.open(data.url, '_blank');
            }
        })
        .catch(uiError)
        .finally(() => {
            btn.disabled = false;
        });
}

function populateDatalistOptions(options: string[], id: string) {
    const dataList = byId(id);
    dataList.innerHTML = '';
    options.sort().forEach((option) => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        dataList.appendChild(optionElement);
    });
}

function clearError() {
    byId('error').innerHTML = '';
}

function uiError(error: any) {
    clearError();
    byId('error').append(
        el('pre', {}, [text(error.stack || error.message || error)]),
        el('br'),
        el('button', { onclick: clearError }, [text('Clear')]),
    );
}

function getSavedConfigName(featureName: string) {
    return localStorage.getItem(featureName + ':configName') ?? '';
}

function saveConfigName(featureName: string, configName: string) {
    localStorage.setItem(featureName + ':configName', configName);
}

/******************* FRAMEWORK *******************/
function el(
    tag: string,
    attributes: Record<string, string | ((this: HTMLElement, e: unknown) => void)> = {},
    children: (HTMLElement | Text)[] = [],
) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (typeof value === 'function') {
            (element as any)[key] = value;
            continue;
        }
        element.setAttribute(key, String(value));
    }
    for (const child of children) {
        element.appendChild(child);
    }
    return element;
}

function text(text: string) {
    return document.createTextNode(text);
}

function byId(id: string) {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Element with id ${id} not found`);
    }
    return el;
}
/******************* ^FRAMEWORK^ *******************/
