export interface Academiejaar {
    year: string;
    defaultSelected: boolean;
    isHidden: boolean;
    isLocked: boolean;
}

export interface DepartementColor {
    colorA: string;
    colorB: string;
}

export interface Opleiding {
    departementColor: DepartementColor;
    departementCode: string;
    naam: string;
    url: string;
    bamaTypeId: number;
    studieTypeId?: number;
    campusId: number;
    departementId: number;
}

export interface ZoekOpleidingRef {
    departementColor: DepartementColor;
    departementCode: string;
    naam: string;
    url: string;
}

export interface ZoekCourseRef {
    naam: string;
    url: string; // numeriek id als string, bv. "230614"
}

export interface ZoekOlodGroep {
    opleiding: ZoekOpleidingRef;
    courses: ZoekCourseRef[];
}

export interface ZoekResultaat {
    invalidInput: boolean;
    errorOccured: boolean;
    numericSearch: boolean;
    schoolYear: string;
    opleidingen: ZoekOpleidingRef[];
    opleidingsonderdelen: ZoekOlodGroep[];
}

export interface ProgrammaDetail {
    departementColor: DepartementColor;
    opleidingNaam: string;
    data: ProgrammaCategorie[];
}

export interface ProgrammaCategorie {
    categorie: string;
    level2Elements: TrajectRef[];
}

export interface TrajectRef {
    naam: string;
    url: string;
}

export interface OpleidingsonderdeelRef {
    id?: number;
    naam: string;
    studiepunten: number;
    url?: string;
}

export interface Keuzegroep {
    naam: string;
    opleidingsonderdelen?: OpleidingsonderdeelRef[];
}

export interface OptionalCourseBlock {
    title: string;
    description?: string;
    courses: Array<{ naam: string; studiepunten: number; url: string }>;
    subBlocks?: OptionalCourseBlock[];
}

// API has two different response formats depending on the traject
export interface DeelTraject {
    // Old format
    naam?: string;
    studiepunten?: number;
    opleidingsonderdelen?: OpleidingsonderdeelRef[];
    keuzegroepen?: Keuzegroep[];
    // New format
    title?: string;
    courses?: Array<{ naam: string; studiepunten: number; url: string }>;
    optionalCourseBlocks?: OptionalCourseBlock[];
}

export interface Traject {
    // Old format
    naam?: string;
    opleidingsonderdelen?: OpleidingsonderdeelRef[];
    // New format
    opleidingNaam?: string;
    trajectNaam?: string;
    // Both
    deelTrajecten?: DeelTraject[];
}

// --- OlodFiche: two distinct response formats ---

export interface EctsComponent {
    name: string;
    angularComponentTag: string;
    content: unknown;
}

export interface EctsBlock {
    blockId: string;
    name: string;
    title: string;
    components: EctsComponent[];
}

export interface LegacyOlodFiche {
    templateName: string;
    ectsBlocks: EctsBlock[];
}

export interface ModernOlodInstructor {
    name: string;
    role: string;
}

export interface ModernOlodFiche {
    course: {
        name: string;
        referenceCode: string;
        academicYear: string;
        credits: number;
        institution: string;
        department: string;
        programme: string;
        specialization?: string;
        language: string;
        quotingScale: string;
        totalStudyHours: number;
        instructors: ModernOlodInstructor[];
    };
    description: string;
    learningOutcomes: string[];
    content: string[];
    teachingMethods: Record<string, string>;
    assessment: Record<string, string>;
    prerequisites: string;
    materials: string[];
}

export type OlodFiche = LegacyOlodFiche | ModernOlodFiche;
