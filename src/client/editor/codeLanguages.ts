import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'


export const codeLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'C/C++',
    alias: ['c', 'cpp', 'c++'],
    extensions: ['c', 'h', 'cpp', 'cc', 'cxx', 'hpp'],
    load: () => import('@codemirror/lang-cpp').then((module) => module.cpp()),
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    load: async () => css(),
  }),
  LanguageDescription.of({
    name: 'Go',
    extensions: ['go'],
    load: () => import('@codemirror/lang-go').then((module) => module.go()),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['htm', 'html5'],
    extensions: ['html', 'htm'],
    load: async () => html(),
  }),
  LanguageDescription.of({
    name: 'Java',
    extensions: ['java'],
    load: () => import('@codemirror/lang-java').then((module) => module.java()),
  }),
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'mjs', 'cjs', 'node'],
    extensions: ['js', 'mjs', 'cjs'],
    load: async () => javascript(),
  }),
  LanguageDescription.of({
    name: 'JSX',
    extensions: ['jsx'],
    load: async () => javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts'],
    extensions: ['ts'],
    load: async () => javascript({ typescript: true }),
  }),
  LanguageDescription.of({
    name: 'TSX',
    extensions: ['tsx'],
    load: async () => javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['jsonc', 'json5'],
    extensions: ['json', 'jsonc'],
    load: () => import('@codemirror/lang-json').then((module) => module.json()),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py'],
    extensions: ['py'],
    load: () => import('@codemirror/lang-python').then((module) => module.python()),
  }),
  LanguageDescription.of({
    name: 'Rust',
    alias: ['rs'],
    extensions: ['rs'],
    load: () => import('@codemirror/lang-rust').then((module) => module.rust()),
  }),
  LanguageDescription.of({
    name: 'Shell',
    alias: ['bash', 'sh', 'zsh'],
    extensions: ['sh', 'bash', 'zsh'],
    load: () =>
      import('@codemirror/legacy-modes/mode/shell').then(
        (module) => new LanguageSupport(StreamLanguage.define(module.shell)),
      ),
  }),
  LanguageDescription.of({
    name: 'SQL',
    extensions: ['sql'],
    load: () => import('@codemirror/lang-sql').then((module) => module.sql()),
  }),
  LanguageDescription.of({
    name: 'XML',
    extensions: ['xml', 'svg'],
    load: () => import('@codemirror/lang-xml').then((module) => module.xml()),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml'],
    extensions: ['yaml', 'yml'],
    load: () => import('@codemirror/lang-yaml').then((module) => module.yaml()),
  }),
]
