export type Greeting = `Hello, ${string}!`;

export function greet(name: string): Greeting {
  return `Hello, ${name as string}!` as Greeting;
}
