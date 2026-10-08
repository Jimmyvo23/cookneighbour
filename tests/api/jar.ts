export type Jar = Map<string, string>;
let current: Jar = new Map();
export function setCurrentJar(j: Jar) {
  current = j;
}
export function getCurrentJar(): Jar {
  return current;
}
