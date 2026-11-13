// @types/node를 새로 깔지 않으려고, 테스트에서 쓰는 만큼만 선언한다.
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: string): string;
}
