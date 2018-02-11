declare module "portastic" {
  export function find(opts: { min: number, max: number }): Promise<number[]>
}
