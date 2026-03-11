import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MonacoEditorWebpackPlugin = require('monaco-editor-webpack-plugin');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

export const plugins = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
  }),
  new MonacoEditorWebpackPlugin({
    languages: ['java', 'xml', 'json', 'plaintext'],
    filename: 'vs/[name].worker.js', // 에러가 났던 vs/assets/ 경로 대신 명확한 vs/ 경로 사용
  }),
];
