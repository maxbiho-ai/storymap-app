declare module "tz-lookup" {
  /** Returns the IANA timezone for a coordinate (throws on invalid input) */
  export default function tzlookup(lat: number, lng: number): string;
}
