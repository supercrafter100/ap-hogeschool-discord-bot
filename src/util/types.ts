/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { type APIApplicationCommandOption } from 'discord-api-types/v10';

export type InversePartial<T> = { [P in keyof T]-?: T[P] };
export type Constructor<T = any> = Function & { prototype: T };
export interface ApplicationCommand {
    name: string;
    description: string;
    default_permission?: boolean;
    options?: APIApplicationCommandOption[];
}
