/**
 * Uniform spatial hash over world XZ space.
 *
 * Used for "what resource nodes / NPCs / buildings are near here" queries,
 * which happen constantly in job search and interaction. Keeps those queries
 * off the O(n) path as entity counts grow into the tens of thousands.
 */
export class SpatialGrid<T> {
  private cells = new Map<number, T[]>();
  private readonly invCell: number;

  constructor(cellSize: number) {
    this.invCell = 1 / cellSize;
  }

  private key(cx: number, cz: number): number {
    // Packs two signed 16-bit cell coords into one integer key.
    return ((cx + 32768) << 16) | (cz + 32768);
  }

  insert(x: number, z: number, item: T): void {
    const k = this.key(Math.floor(x * this.invCell), Math.floor(z * this.invCell));
    const list = this.cells.get(k);
    if (list) list.push(item);
    else this.cells.set(k, [item]);
  }

  remove(x: number, z: number, item: T): boolean {
    const k = this.key(Math.floor(x * this.invCell), Math.floor(z * this.invCell));
    const list = this.cells.get(k);
    if (!list) return false;
    const i = list.indexOf(item);
    if (i < 0) return false;
    list[i] = list[list.length - 1];
    list.pop();
    if (list.length === 0) this.cells.delete(k);
    return true;
  }

  move(fromX: number, fromZ: number, toX: number, toZ: number, item: T): void {
    const fk = this.key(Math.floor(fromX * this.invCell), Math.floor(fromZ * this.invCell));
    const tk = this.key(Math.floor(toX * this.invCell), Math.floor(toZ * this.invCell));
    if (fk === tk) return;
    this.remove(fromX, fromZ, item);
    this.insert(toX, toZ, item);
  }

  /** Calls `fn` for every item in cells overlapping the radius (broad phase). */
  forEachNear(x: number, z: number, radius: number, fn: (item: T) => void): void {
    const minX = Math.floor((x - radius) * this.invCell);
    const maxX = Math.floor((x + radius) * this.invCell);
    const minZ = Math.floor((z - radius) * this.invCell);
    const maxZ = Math.floor((z + radius) * this.invCell);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) fn(list[i]);
      }
    }
  }

  /** Collects items in cells overlapping the radius. */
  queryNear(x: number, z: number, radius: number): T[] {
    const out: T[] = [];
    this.forEachNear(x, z, radius, (it) => out.push(it));
    return out;
  }

  clear(): void {
    this.cells.clear();
  }

  get cellCount(): number {
    return this.cells.size;
  }
}
