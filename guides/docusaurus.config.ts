import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes } from 'prism-react-renderer';

const config: Config = {
    title: 'Engine Docs',
    url: 'https://dazl-dev.github.io/',
    baseUrl: '/engine/guides/',
    onBrokenLinks: 'throw',
    onBrokenMarkdownLinks: 'warn',
    i18n: {
        defaultLocale: 'en',
        locales: ['en'],
    },
    presets: [
        [
            'classic',
            {
                theme: {
                    customCss: [require.resolve('./src/css/custom.css')],
                },
                docs: {
                    routeBasePath: '/',
                    sidebarPath: require.resolve('./sidebars.js'),
                },
            } satisfies Preset.Options,
        ],
    ],
    markdown: {
        mermaid: true,
    },
    themes: ['@docusaurus/theme-mermaid'],
    themeConfig: {
        navbar: {
            logo: {
                alt: 'Engine Logo',
                src: 'img/logo_light.svg',
                srcDark: 'img/logo_dark.svg',
            },
            items: [
                {
                    type: 'docSidebar',
                    sidebarId: 'tutorialSidebar',
                    position: 'left',
                    label: 'Docs',
                },
                {
                    href: 'https://dazl-dev.github.io/engine',
                    target: '_self',
                    position: 'left',
                    label: 'API Reference',
                },
                {
                    href: 'https://github.com/dazl-dev/engine',
                    label: 'GitHub',
                    position: 'right',
                },
            ],
        },
        footer: {
            style: 'dark',
            links: [
                {
                    title: 'Documentation',
                    items: [
                        {
                            label: 'API Reference',
                            to: 'https://dazl-dev.github.io/engine/',
                        },
                    ],
                },
                {
                    title: 'More',
                    items: [
                        {
                            label: 'GitHub',
                            href: 'https://github.com/dazl-dev/engine',
                        },
                    ],
                },
            ],
            copyright: `Copyright © 2006-${new Date().getFullYear()} Dazl LTD. Built with Docusaurus.`,
        },
        prism: {
            theme: themes.github,
            darkTheme: themes.dracula,
        },
    } satisfies Preset.ThemeConfig,
};

export default config;
