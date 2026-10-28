export type MealCategory = "NUTRICIONAL" | "CHATARRA";
export type MealService = "ALMUERZO" | "CENA" | "AMBOS";
export type MealDifficulty = "FACIL" | "MEDIA" | "ALTA";
export type ProteinSource = "POLLO" | "VACUNA" | "CERDO" | "PESCADO" | "ATUN" | "HUEVO" | "LEGUMBRES" | "VEGETAL" | "LACTEOS" | "MIXTA";
export type CookingMethod = "HORNO" | "PLANCHA" | "HERVIDO" | "SIN_COCCION" | "SALTEADO" | "GUISADO" | "FRITURA" | "PARRILLA" | "HORNO_Y_PLANCHA";

export type Comida = {
  id: string;
  name: string;
  normalizedName: string;
  category: MealCategory;
  mealService: MealService;
  description: string;
  ingredients: string;
  preparation: string;
  portion: string;
  calories: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  fiberGrams: number;
  sodiumMilligrams: number;
  preparationMinutes: number;
  difficulty: MealDifficulty;
  estimatedCost: number;
  currency: "ARS";
  suitableForCanteen: boolean;
  observations: string;
  proteinSource: ProteinSource;
  cookingMethod: CookingMethod;
  vegetarian: boolean;
  containsMeat: boolean;
  containsFish: boolean;
  containsLegumes: boolean;
  }
type VariantGroup = "LOMITO" | "PIZZA" | "PANCHO" | "FRITO" | "EMPANADA" | "PASTA";
type MealBase = Omit<Comida, "id" | "normalizedName" | "category" | "description" | "portion" | "calories" | "fiberGrams" | "sodiumMilligrams" | "estimatedCost" | "currency" | "suitableForCanteen" | "observations" | "vegetarian" | "containsMeat" | "containsFish" | "containsLegumes"> & {
  baseFiber: number;
  baseSodium: number;
  baseCost: number;
  variantGroup?: VariantGroup;
};

function makeBase(
  name: string, proteinSource: ProteinSource, cookingMethod: CookingMethod,
  proteinGrams: number, carbohydrateGrams: number, fatGrams: number,
  baseFiber: number, baseSodium: number, baseCost: number, preparationMinutes: number,
  difficulty: MealDifficulty, ingredients: string, preparation: string,
  mealService: MealService = "AMBOS", variantGroup?: VariantGroup
): MealBase {
  return { name, proteinSource, cookingMethod, proteinGrams, carbohydrateGrams, fatGrams,
    baseFiber, baseSodium, baseCost, preparationMinutes, difficulty, ingredients, preparation,
    mealService, variantGroup };
}

const nutritionalBases: MealBase[] = [
  makeBase("Pollo al horno al limón y orégano", "POLLO", "HORNO", 31, 10, 12, 1, 390, 2850, 45, "FACIL", "pollo, limón, ajo, orégano y aceite", "Condimentar el pollo y hornear hasta que esté completamente cocido."),
  makeBase("Pechuga rellena de espinaca y ricota", "POLLO", "HORNO", 34, 9, 14, 2, 430, 3300, 55, "MEDIA", "pechuga, espinaca, ricota, cebolla y huevo", "Rellenar las pechugas, sujetar y hornear hasta alcanzar cocción completa."),
  makeBase("Pollo salteado con morrón, cebolla y zapallito", "POLLO", "SALTEADO", 29, 15, 11, 3, 410, 2900, 35, "FACIL", "pollo, morrón, cebolla, zapallito y aceite", "Cortar en cubos, saltear el pollo y sumar las verduras hasta que queden tiernas."),
  makeBase("Muslo de pollo grillado con hierbas", "POLLO", "PARRILLA", 30, 8, 13, 1, 370, 2700, 45, "FACIL", "muslo de pollo, perejil, ajo y limón", "Marinar con hierbas y cocinar a la parrilla hasta que no queden partes rosadas."),
  makeBase("Albóndigas de pollo en salsa de tomate casera", "POLLO", "GUISADO", 28, 18, 12, 3, 510, 2950, 50, "MEDIA", "pollo picado, avena, huevo, tomate y cebolla", "Formar albóndigas y cocinar a fuego moderado dentro de la salsa de tomate."),
  makeBase("Pollo guisado con verduras y pimentón", "POLLO", "GUISADO", 27, 19, 11, 4, 480, 2800, 55, "FACIL", "pollo, zanahoria, cebolla, tomate y pimentón", "Dorar el pollo, agregar verduras y cocinar tapado hasta que todo esté tierno."),
  makeBase("Milanesa de pollo al horno con rebozado de avena", "POLLO", "HORNO", 32, 16, 13, 3, 520, 3000, 40, "FACIL", "pollo, avena, huevo, ajo y perejil", "Rebozar las piezas y hornear en placa aceitada, dándolas vuelta una vez."),
  makeBase("Pastel de pollo y calabaza", "POLLO", "HORNO", 25, 25, 12, 5, 440, 2850, 55, "MEDIA", "pollo, calabaza, cebolla, leche y queso", "Cocinar el pollo desmenuzado, cubrir con puré de calabaza y gratinar suavemente."),
  makeBase("Pollo a la plancha con salsa criolla", "POLLO", "PLANCHA", 32, 9, 11, 2, 390, 2750, 30, "FACIL", "pollo, tomate, cebolla, morrón, vinagre y perejil", "Cocinar el pollo a la plancha y servir con salsa criolla fresca."),
  makeBase("Cazuela de pollo, garbanzos y verduras", "POLLO", "GUISADO", 28, 24, 10, 7, 500, 3000, 60, "MEDIA", "pollo, garbanzos, zanahoria, zapallo y tomate", "Cocinar los garbanzos y terminar la cazuela con pollo y verduras en una olla amplia."),
  makeBase("Carne vacuna al horno con ajo y romero", "VACUNA", "HORNO", 32, 8, 15, 1, 420, 3700, 65, "MEDIA", "carne vacuna, ajo, romero y aceite", "Sellar la carne, condimentar y hornear hasta el punto de cocción indicado."),
  makeBase("Bife magro a la plancha con perejil", "VACUNA", "PLANCHA", 34, 7, 13, 1, 360, 3650, 25, "FACIL", "bife vacuno, perejil, ajo y limón", "Cocinar los bifes en plancha caliente y terminar con ajo y perejil."),
  makeBase("Estofado de carne vacuna con tomate", "VACUNA", "GUISADO", 29, 18, 14, 3, 520, 3500, 70, "MEDIA", "carne vacuna, tomate, cebolla, zanahoria y laurel", "Dorar la carne y cocinar lentamente con tomate y verduras hasta tiernizar."),
  makeBase("Carne vacuna salteada con brócoli y morrón", "VACUNA", "SALTEADO", 30, 17, 13, 4, 490, 3650, 35, "FACIL", "carne vacuna, brócoli, morrón, cebolla y aceite", "Saltear la carne en tiras y agregar las verduras hasta que queden cocidas pero firmes."),
  makeBase("Albóndigas de carne magra con salsa de tomate", "VACUNA", "GUISADO", 28, 17, 14, 3, 540, 3450, 50, "MEDIA", "carne magra, huevo, avena, tomate y cebolla", "Formar albóndigas pequeñas y cocinar dentro de la salsa hasta que estén bien cocidas."),
  makeBase("Pastel de carne vacuna y papa", "VACUNA", "HORNO", 26, 25, 15, 4, 560, 3400, 60, "MEDIA", "carne picada, papa, cebolla, leche y nuez moscada", "Cocinar el relleno de carne, cubrir con puré de papa y llevar al horno."),
  makeBase("Carne vacuna a la cacerola con zapallo", "VACUNA", "GUISADO", 29, 20, 13, 5, 480, 3500, 65, "MEDIA", "carne vacuna, zapallo, cebolla, tomate y pimentón", "Cocinar en cacerola tapada, agregando el zapallo cuando la carne comience a tiernizar."),
  makeBase("Milanesa de nalga al horno", "VACUNA", "HORNO", 31, 15, 15, 2, 570, 3900, 40, "FACIL", "nalga, huevo, pan rallado, ajo y perejil", "Rebozar los bifes y hornear en placa apenas aceitada, volteando a mitad de cocción."),
  makeBase("Carne vacuna mechada con verduras", "VACUNA", "HORNO", 31, 12, 15, 3, 450, 3850, 75, "ALTA", "carne vacuna, zanahoria, cebolla, morrón y ajo", "Rellenar la pieza con verduras, sellar y hornear hasta cocción completa."),
  makeBase("Puchero liviano de carne y hortalizas", "VACUNA", "HERVIDO", 26, 24, 11, 6, 440, 3500, 75, "MEDIA", "carne vacuna, zapallo, zanahoria, repollo y puerro", "Hervir la carne a fuego bajo y sumar las hortalizas según su tiempo de cocción."),
  makeBase("Bondiola de cerdo al horno con mostaza", "CERDO", "HORNO", 30, 10, 17, 1, 520, 3300, 60, "MEDIA", "bondiola, mostaza, ajo y limón", "Untar la bondiola con mostaza y hornear cubierta hasta que esté bien cocida."),
  makeBase("Cerdo a la plancha con manzana y cebolla", "CERDO", "PLANCHA", 29, 17, 15, 3, 470, 3150, 35, "FACIL", "cerdo magro, manzana, cebolla y tomillo", "Cocinar el cerdo a la plancha y saltear aparte la manzana y la cebolla."),
  makeBase("Guiso magro de cerdo con porotos blancos", "CERDO", "GUISADO", 27, 27, 13, 8, 560, 3250, 65, "MEDIA", "cerdo magro, porotos blancos, tomate y verduras", "Cocinar los porotos y terminar el guiso con cerdo magro y verduras."),
  makeBase("Solomillo de cerdo con vegetales asados", "CERDO", "HORNO", 32, 15, 12, 4, 430, 3350, 50, "MEDIA", "solomillo, berenjena, morrón, cebolla y aceite", "Sellar el solomillo, asar con las verduras y verificar la cocción interna."),
  makeBase("Tiras de cerdo salteadas con repollo y zanahoria", "CERDO", "SALTEADO", 28, 18, 14, 4, 500, 3100, 35, "FACIL", "cerdo, repollo, zanahoria, cebolla y jengibre", "Saltear el cerdo en tiras y sumar repollo y zanahoria hasta que queden tiernos."),
  makeBase("Merluza al horno con limón y perejil", "PESCADO", "HORNO", 30, 8, 9, 1, 390, 3400, 35, "FACIL", "filete de merluza, limón, perejil y ajo", "Hornear la merluza condimentada hasta que se desmenuce fácilmente."),
  makeBase("Filet de merluza a la plancha", "PESCADO", "PLANCHA", 31, 7, 9, 1, 360, 3350, 25, "FACIL", "merluza, limón, ajo y aceite", "Cocinar el filet en plancha aceitada y servir bien cocido."),
  makeBase("Guiso de pescado con tomate y papa", "PESCADO", "GUISADO", 27, 20, 10, 4, 480, 3450, 50, "MEDIA", "pescado blanco, papa, tomate, cebolla y perejil", "Cocinar las verduras en salsa y agregar el pescado al final para que no se desarme."),
  makeBase("Pescado en papillote con verduras", "PESCADO", "HORNO", 29, 14, 10, 4, 390, 3500, 40, "MEDIA", "filete de pescado, zanahoria, cebolla, zapallito y limón", "Cerrar porciones individuales en papel de horno y cocinar hasta que el pescado esté opaco."),
  makeBase("Filet de pescado con costra de avena al horno", "PESCADO", "HORNO", 30, 15, 11, 3, 500, 3450, 35, "FACIL", "filet de pescado, avena, huevo, limón y perejil", "Cubrir el pescado con avena y hornear hasta que la superficie quede dorada."),
  makeBase("Pastel de merluza y calabaza", "PESCADO", "HORNO", 25, 24, 11, 5, 470, 3200, 50, "MEDIA", "merluza, calabaza, cebolla, leche y queso", "Cocinar la merluza, cubrir con puré de calabaza y gratinar moderadamente."),
  makeBase("Ensalada tibia de atún, huevo y papa", "ATUN", "HERVIDO", 27, 23, 12, 4, 620, 2950, 30, "FACIL", "atún al natural, huevo, papa, chauchas y limón", "Hervir las verduras y el huevo, mezclar con atún escurrido y servir tibio."),
  makeBase("Tarta integral de atún y verduras", "ATUN", "HORNO", 24, 27, 14, 5, 650, 3000, 55, "MEDIA", "atún, masa integral, huevo, cebolla y morrón", "Rellenar la masa integral con atún y verduras y hornear hasta que esté firme."),
  makeBase("Guiso de lentejas con zapallo y verduras", "LEGUMBRES", "GUISADO", 20, 42, 10, 12, 470, 2450, 65, "FACIL", "lentejas, zapallo, zanahoria, tomate y cebolla", "Cocinar las lentejas con las verduras en olla grande hasta que queden tiernas."),
  makeBase("Cazuela de garbanzos con espinaca", "LEGUMBRES", "GUISADO", 19, 40, 11, 12, 450, 2550, 60, "FACIL", "garbanzos, espinaca, tomate, cebolla y pimentón", "Cocinar los garbanzos y terminar la cazuela con espinaca y salsa de tomate."),
  makeBase("Hamburguesa casera de lentejas al horno", "LEGUMBRES", "HORNO", 18, 35, 11, 11, 440, 2500, 45, "MEDIA", "lentejas, avena, cebolla, huevo y perejil", "Procesar parcialmente las lentejas, formar medallones y hornear hasta dorar."),
  makeBase("Porotos negros guisados con arroz y verduras", "LEGUMBRES", "GUISADO", 19, 45, 9, 13, 460, 2500, 65, "MEDIA", "porotos negros, arroz, tomate, cebolla y morrón", "Cocinar porotos y arroz por separado y unirlos con verduras salteadas."),
  makeBase("Garbanzos al horno con vegetales y pimentón", "LEGUMBRES", "HORNO", 18, 39, 12, 12, 410, 2550, 50, "FACIL", "garbanzos, berenjena, cebolla, tomate y pimentón", "Asar los garbanzos y vegetales condimentados en placas separadas."),
  makeBase("Pastel de lentejas y papa", "LEGUMBRES", "HORNO", 19, 44, 10, 13, 500, 2450, 60, "MEDIA", "lentejas, papa, cebolla, zanahoria y leche", "Preparar un relleno espeso de lentejas, cubrir con puré y hornear."),
  makeBase("Guiso de arvejas partidas con verduras", "LEGUMBRES", "GUISADO", 18, 43, 9, 12, 430, 2350, 60, "FACIL", "arvejas partidas, zanahoria, puerro, zapallo y laurel", "Hervir las arvejas hasta ablandar y sumar las verduras picadas."),
  makeBase("Tortilla al horno de acelga y huevo", "HUEVO", "HORNO", 20, 13, 14, 4, 460, 2350, 35, "FACIL", "acelga, huevo, cebolla, leche y nuez moscada", "Mezclar acelga cocida con huevo y hornear en una fuente aceitada."),
  makeBase("Tarta integral de calabaza y ricota", "LACTEOS", "HORNO", 19, 27, 15, 5, 470, 2500, 50, "MEDIA", "masa integral, calabaza, ricota, cebolla y huevo", "Rellenar la masa con calabaza y ricota y hornear hasta que el centro coagule."),
  makeBase("Berenjenas rellenas de quinoa y verduras", "VEGETAL", "HORNO", 16, 31, 12, 8, 390, 2500, 50, "MEDIA", "berenjena, quinoa, tomate, cebolla y queso", "Asar las berenjenas, rellenar con quinoa cocida y gratinar levemente."),
  makeBase("Pastel de choclo y porotos", "LEGUMBRES", "HORNO", 18, 42, 11, 11, 460, 2550, 55, "MEDIA", "choclo, porotos, cebolla, tomate y leche", "Preparar el relleno de porotos y verduras, cubrir con choclo procesado y hornear."),
  makeBase("Arroz integral con huevo, arvejas y verduras", "HUEVO", "SALTEADO", 19, 40, 12, 7, 440, 2350, 35, "FACIL", "arroz integral, huevo, arvejas, zanahoria y cebolla", "Cocinar el arroz, saltear las verduras y mezclar con huevo completamente cocido."),
  makeBase("Fideos integrales con salsa de tomate y ricota", "LACTEOS", "HERVIDO", 21, 43, 12, 8, 510, 2450, 35, "FACIL", "fideos integrales, tomate, ricota, ajo y albahaca", "Hervir la pasta al dente y servir con salsa de tomate y ricota."),
  makeBase("Polenta suave con salsa de verduras y queso", "LACTEOS", "HERVIDO", 17, 39, 13, 6, 490, 2250, 35, "FACIL", "harina de maíz, tomate, cebolla, zanahoria y queso", "Cocinar la polenta revolviendo y acompañar con salsa casera de verduras."),
  makeBase("Tortilla de papa, cebolla y espinaca al horno", "HUEVO", "HORNO", 19, 25, 14, 5, 480, 2300, 45, "MEDIA", "papa, huevo, cebolla, espinaca y aceite", "Cocinar la papa y la cebolla, mezclar con huevo y espinaca y hornear."),
  makeBase("Zapallitos rellenos de arroz y queso", "LACTEOS", "HORNO", 17, 29, 13, 5, 450, 2250, 45, "MEDIA", "zapallitos, arroz, cebolla, tomate y queso", "Ahuecar los zapallitos, rellenar con arroz y verduras y llevar al horno."),
  makeBase("Lasaña de verduras con salsa blanca liviana", "LACTEOS", "HORNO", 20, 32, 15, 6, 590, 2800, 65, "ALTA", "láminas de pasta, acelga, calabaza, leche y queso", "Alternar capas de pasta y verduras, cubrir con salsa blanca liviana y hornear.", "CENA")
];

type Side = { name: string; ingredients: string; preparation: string; protein: number; carbs: number; fat: number; fiber: number; sodium: number; cost: number };
const nutritionalSides: Side[] = [
  { name: "arroz integral y ensalada fresca", ingredients: "arroz integral, tomate y lechuga", preparation: "Hervir el arroz y lavar y cortar la ensalada", protein: 4, carbs: 38, fat: 3, fiber: 5, sodium: 210, cost: 520 },
  { name: "puré de calabaza y zanahoria", ingredients: "calabaza, zanahoria y leche", preparation: "Hervir y pisar la calabaza y la zanahoria", protein: 3, carbs: 25, fat: 4, fiber: 6, sodium: 230, cost: 430 },
  { name: "quinoa con verduras asadas", ingredients: "quinoa, berenjena y cebolla", preparation: "Hervir la quinoa y asar las verduras en placa", protein: 7, carbs: 31, fat: 7, fiber: 6, sodium: 260, cost: 720 },
  { name: "batata al horno con repollo fresco", ingredients: "batata, repollo y limón", preparation: "Hornear la batata y servir con repollo cortado fino", protein: 4, carbs: 33, fat: 3, fiber: 7, sodium: 190, cost: 500 },
  { name: "papas al horno y hojas verdes", ingredients: "papa, acelga tierna y limón", preparation: "Hornear las papas en cubos y acompañar con hojas verdes", protein: 5, carbs: 36, fat: 5, fiber: 6, sodium: 250, cost: 480 }
];

const junkSides: Record<VariantGroup, Side[]> = {
  LOMITO: [
    { name: "papas fritas y mayonesa", ingredients: "papas, aceite, mayonesa y sal", preparation: "Freír las papas y servir con mayonesa", protein: 4, carbs: 36, fat: 19, fiber: 4, sodium: 760, cost: 850 },
    { name: "doble cheddar, panceta y papas", ingredients: "queso cheddar, panceta, papas y aceite", preparation: "Fundir el cheddar, dorar la panceta y freír las papas", protein: 16, carbs: 34, fat: 30, fiber: 3, sodium: 980, cost: 1250 },
    { name: "aros de cebolla fritos y salsa golf", ingredients: "cebolla, rebozado, aceite y salsa golf", preparation: "Rebozar y freír los aros y servir con salsa golf", protein: 5, carbs: 39, fat: 18, fiber: 3, sodium: 720, cost: 900 },
    { name: "papas rejilla con salsa barbacoa", ingredients: "papas, aceite, salsa barbacoa y sal", preparation: "Freír las papas rejilla y acompañar con salsa barbacoa", protein: 4, carbs: 41, fat: 17, fiber: 4, sodium: 850, cost: 900 },
    { name: "extra de mozzarella y salsa especial", ingredients: "mozzarella, mayonesa, kétchup y mostaza", preparation: "Fundir la mozzarella y agregar las salsas al servir", protein: 13, carbs: 15, fat: 24, fiber: 1, sodium: 870, cost: 1050 }
  ],
  PIZZA: [
    { name: "borde relleno de queso y salsa extra", ingredients: "masa, mozzarella, salsa de tomate y aceite", preparation: "Rellenar el borde, cubrir con salsa y hornear", protein: 12, carbs: 34, fat: 20, fiber: 2, sodium: 920, cost: 950 },
    { name: "doble mozzarella y aceitunas", ingredients: "mozzarella, aceitunas, salsa y masa", preparation: "Agregar doble queso y aceitunas antes de hornear", protein: 16, carbs: 22, fat: 24, fiber: 2, sodium: 1050, cost: 1150 },
    { name: "panceta y salsa barbacoa", ingredients: "panceta, queso, salsa barbacoa y masa", preparation: "Cubrir con panceta y barbacoa y hornear hasta fundir el queso", protein: 14, carbs: 28, fat: 25, fiber: 1, sodium: 1100, cost: 1300 },
    { name: "papas fritas con cheddar", ingredients: "papas, aceite, cheddar y sal", preparation: "Freír las papas y cubrir con cheddar fundido", protein: 9, carbs: 39, fat: 23, fiber: 3, sodium: 1050, cost: 1150 },
    { name: "salame, extra de queso y aderezo", ingredients: "salame, queso, mayonesa y masa", preparation: "Agregar salame y queso extra y hornear; servir con aderezo", protein: 16, carbs: 20, fat: 29, fiber: 1, sodium: 1250, cost: 1250 }
  ],
  PANCHO: [
    { name: "papas pay, salsa golf y mayonesa", ingredients: "salchicha, pan, papas pay, salsa golf y mayonesa", preparation: "Calentar la salchicha, montar en pan y cubrir con salsas y papas pay", protein: 5, carbs: 36, fat: 21, fiber: 2, sodium: 1050, cost: 780 },
    { name: "doble salchicha, cheddar y panceta", ingredients: "salchichas, pan, cheddar y panceta", preparation: "Dorar las salchichas y la panceta y servir con cheddar fundido", protein: 18, carbs: 32, fat: 30, fiber: 2, sodium: 1350, cost: 1150 },
    { name: "papas fritas y kétchup", ingredients: "salchicha, pan, papas, aceite y kétchup", preparation: "Freír las papas y servir con el pancho y kétchup", protein: 4, carbs: 42, fat: 19, fiber: 3, sodium: 1000, cost: 850 },
    { name: "huevo frito, queso y salsa golf", ingredients: "salchicha, pan, huevo, queso y salsa golf", preparation: "Freír el huevo, calentar la salchicha y montar con queso y salsa", protein: 15, carbs: 31, fat: 26, fiber: 1, sodium: 1180, cost: 1050 },
    { name: "cebolla frita y salsa barbacoa", ingredients: "salchicha, pan, cebolla, rebozado y barbacoa", preparation: "Freír la cebolla y agregarla con salsa barbacoa al pancho", protein: 5, carbs: 39, fat: 20, fiber: 2, sodium: 1120, cost: 850 }
  ],
  FRITO: [
    { name: "papas fritas con mayonesa", ingredients: "papas, aceite, mayonesa y sal", preparation: "Freír las papas y servir con mayonesa", protein: 4, carbs: 36, fat: 19, fiber: 4, sodium: 760, cost: 850 },
    { name: "papas con cheddar y panceta", ingredients: "papas, aceite, cheddar y panceta", preparation: "Freír las papas y cubrir con cheddar y panceta dorada", protein: 13, carbs: 37, fat: 28, fiber: 3, sodium: 1050, cost: 1150 },
    { name: "bastones de mozzarella fritos", ingredients: "mozzarella, rebozado, huevo y aceite", preparation: "Rebozar los bastones y freír hasta que el queso se funda", protein: 13, carbs: 31, fat: 24, fiber: 1, sodium: 950, cost: 1200 },
    { name: "aros de cebolla y salsa tártara", ingredients: "cebolla, rebozado, aceite y salsa tártara", preparation: "Rebozar y freír los aros y servir con salsa tártara", protein: 5, carbs: 39, fat: 20, fiber: 3, sodium: 870, cost: 950 },
    { name: "papas rústicas y salsa barbacoa", ingredients: "papas, aceite, barbacoa y sal", preparation: "Freír las papas rústicas y acompañar con salsa barbacoa", protein: 4, carbs: 40, fat: 17, fiber: 4, sodium: 910, cost: 850 }
  ],
  EMPANADA: [
    { name: "papas fritas y salsa criolla", ingredients: "empanadas, papas, aceite, tomate y cebolla", preparation: "Freír las empanadas y las papas; servir con salsa criolla", protein: 5, carbs: 43, fat: 22, fiber: 4, sodium: 950, cost: 900 },
    { name: "doble porción frita con mayonesa", ingredients: "empanadas, aceite y mayonesa", preparation: "Freír una porción abundante y acompañar con mayonesa", protein: 5, carbs: 35, fat: 25, fiber: 2, sodium: 1050, cost: 850 },
    { name: "papas rejilla y cheddar", ingredients: "empanadas, papas, aceite y queso cheddar", preparation: "Freír las empanadas y las papas y cubrir con cheddar", protein: 10, carbs: 42, fat: 28, fiber: 3, sodium: 1200, cost: 1100 },
    { name: "aros de cebolla y aderezo industrial", ingredients: "empanadas, cebolla, rebozado y aderezo", preparation: "Freír las empanadas y los aros y servir con aderezo", protein: 6, carbs: 41, fat: 23, fiber: 3, sodium: 1130, cost: 1050 },
    { name: "papas fritas, queso y panceta", ingredients: "empanadas, papas, queso y panceta", preparation: "Freír las empanadas y las papas; terminar con queso y panceta", protein: 14, carbs: 41, fat: 31, fiber: 3, sodium: 1300, cost: 1250 }
  ],
  PASTA: [
    { name: "salsa cuatro quesos y panceta", ingredients: "pasta, crema, quesos y panceta", preparation: "Calentar la crema con los quesos y sumar panceta dorada", protein: 16, carbs: 28, fat: 29, fiber: 1, sodium: 1150, cost: 1250 },
    { name: "crema, cheddar y salchicha", ingredients: "pasta, crema, cheddar y salchicha", preparation: "Mezclar la pasta con crema, cheddar fundido y salchicha dorada", protein: 17, carbs: 29, fat: 28, fiber: 1, sodium: 1200, cost: 1250 },
    { name: "gratinado de mozzarella y jamón", ingredients: "pasta, mozzarella, jamón y crema", preparation: "Cubrir con mozzarella y jamón y gratinar hasta dorar", protein: 18, carbs: 27, fat: 25, fiber: 1, sodium: 1120, cost: 1300 },
    { name: "salsa rosa con queso rallado extra", ingredients: "pasta, crema, salsa de tomate y queso", preparation: "Mezclar con salsa rosa y terminar con queso rallado abundante", protein: 13, carbs: 31, fat: 24, fiber: 1, sodium: 980, cost: 1050 },
    { name: "manteca, crema y crocante de panceta", ingredients: "pasta, manteca, crema y panceta", preparation: "Mezclar la pasta caliente con manteca, crema y panceta", protein: 16, carbs: 28, fat: 32, fiber: 1, sodium: 1080, cost: 1200 }
  ]
};

function base(
  name: string, source: ProteinSource, method: CookingMethod, protein: number, carbs: number,
  fat: number, fiber: number, sodium: number, cost: number, minutes: number,
  difficulty: MealDifficulty, ingredients: string, preparation: string,
  service: MealService = "AMBOS", group?: VariantGroup
): MealBase {
  return makeBase(name, source, method, protein, carbs, fat, fiber, sodium, cost, minutes, difficulty,
    ingredients, preparation, service, group);
}

const junkBases: MealBase[] = [
  base("Hamburguesa doble con queso y cebolla caramelizada", "MIXTA", "PLANCHA", 33, 48, 31, 3, 980, 3900, 30, "MEDIA", "carne vacuna, pan blanco, cheddar, cebolla y mayonesa", "Cocinar la carne a la plancha, fundir el queso y montar con salsas", "AMBOS", "LOMITO"),
  base("Hamburguesa completa con huevo y jamón", "MIXTA", "PLANCHA", 35, 50, 34, 3, 1120, 4200, 35, "MEDIA", "carne, pan, huevo, jamón, queso y mayonesa", "Cocinar el medallón y el huevo y montar con jamón, queso y aderezos", "AMBOS", "LOMITO"),
  base("Hamburguesa de carne con cheddar y pepinillos", "MIXTA", "PLANCHA", 31, 47, 29, 3, 1050, 3800, 30, "FACIL", "carne, pan, cheddar, pepinillos y salsa", "Cocinar el medallón, fundir cheddar y montar con pepinillos y salsa", "AMBOS", "LOMITO"),
  base("Hamburguesa de pollo rebozado con salsa especial", "POLLO", "FRITURA", 29, 55, 32, 3, 1080, 3700, 35, "MEDIA", "pollo, pan, rebozado, queso y salsa especial", "Rebozar y freír el pollo y montar el sándwich con queso y salsa", "AMBOS", "LOMITO"),
  base("Hamburguesa triple de carne con panceta", "MIXTA", "PLANCHA", 42, 48, 42, 3, 1320, 5200, 40, "MEDIA", "carne, pan, panceta, cheddar y mayonesa", "Cocinar tres medallones, dorar la panceta y montar con cheddar", "CENA", "LOMITO"),
  base("Hamburguesa de cerdo con barbacoa y queso", "CERDO", "PLANCHA", 30, 49, 32, 3, 1060, 3900, 35, "MEDIA", "cerdo, pan, queso, salsa barbacoa y cebolla", "Cocinar el medallón de cerdo y montar con queso y barbacoa", "AMBOS", "LOMITO"),
  base("Hamburguesa de lentejas frita con cheddar", "LEGUMBRES", "FRITURA", 18, 53, 30, 7, 950, 3200, 35, "MEDIA", "lentejas, pan, rebozado, cheddar y mayonesa", "Formar el medallón, freír y servir en pan con cheddar y mayonesa", "AMBOS", "LOMITO"),
  base("Hamburguesa criolla con provoleta y chimichurri", "MIXTA", "PARRILLA", 34, 47, 33, 3, 1080, 4250, 35, "MEDIA", "carne, pan, provoleta, chimichurri y mayonesa", "Cocinar el medallón a la parrilla, fundir la provoleta y montar", "AMBOS", "LOMITO"),
  base("Hamburguesa de pollo crispy con miel y mostaza", "POLLO", "FRITURA", 30, 59, 31, 3, 1120, 3900, 35, "MEDIA", "pollo, pan, rebozado, miel, mostaza y mayonesa", "Freír el pollo rebozado y montar con miel, mostaza y mayonesa", "AMBOS", "LOMITO"),
  base("Pizza muzzarella con doble queso", "LACTEOS", "HORNO", 26, 72, 25, 3, 1180, 3400, 35, "MEDIA", "masa, mozzarella, salsa de tomate y aceite", "Cubrir la masa con salsa y abundante mozzarella y hornear", "AMBOS", "PIZZA"),
  base("Pizza de jamón y morrones", "MIXTA", "HORNO", 28, 71, 26, 3, 1250, 3700, 35, "MEDIA", "masa, jamón, mozzarella, morrón y salsa", "Distribuir jamón, queso y morrón sobre la masa y hornear", "AMBOS", "PIZZA"),
  base("Pizza de pepperoni y mozzarella", "MIXTA", "HORNO", 27, 72, 29, 3, 1390, 3900, 35, "MEDIA", "masa, pepperoni, mozzarella y salsa de tomate", "Cubrir la masa con salsa, pepperoni y queso y hornear", "AMBOS", "PIZZA"),
  base("Pizza fugazzeta rellena de queso", "LACTEOS", "HORNO", 29, 74, 31, 3, 1320, 3900, 45, "MEDIA", "masa, mozzarella, cebolla y aceite", "Rellenar la masa con queso, cubrir con cebolla y hornear", "CENA", "PIZZA"),
  base("Pizza cuatro quesos con crema", "LACTEOS", "HORNO", 28, 69, 32, 2, 1360, 4200, 35, "MEDIA", "masa, mozzarella, cheddar, queso azul y crema", "Distribuir los quesos y la crema sobre la masa y hornear", "CENA", "PIZZA"),
  base("Pizza de panceta, cebolla y mozzarella", "MIXTA", "HORNO", 28, 70, 32, 3, 1410, 4200, 40, "MEDIA", "masa, panceta, cebolla, mozzarella y salsa", "Dorar la panceta, agregar a la masa con cebolla y queso y hornear", "CENA", "PIZZA"),
  base("Pizza de salame y aceitunas", "MIXTA", "HORNO", 27, 72, 30, 3, 1450, 4100, 35, "MEDIA", "masa, salame, aceitunas, mozzarella y salsa", "Cubrir la masa con salame, aceitunas y mozzarella y hornear", "AMBOS", "PIZZA"),
  base("Pizza de salchicha y cheddar", "MIXTA", "HORNO", 27, 74, 29, 2, 1390, 3900, 35, "MEDIA", "masa, salchicha, cheddar y salsa", "Agregar salchicha y cheddar a la masa y hornear hasta fundir", "AMBOS", "PIZZA"),
  base("Pizza de pollo con salsa barbacoa", "POLLO", "HORNO", 30, 73, 27, 3, 1230, 4100, 40, "MEDIA", "masa, pollo, barbacoa, mozzarella y cebolla", "Cocinar el pollo, distribuir con barbacoa y queso y hornear", "AMBOS", "PIZZA"),
  base("Pancho completo con salchicha y aderezos", "MIXTA", "HERVIDO", 15, 43, 25, 2, 1320, 2500, 20, "FACIL", "salchicha, pan blanco, mayonesa, kétchup y mostaza", "Calentar la salchicha y servir en pan con aderezos", "AMBOS", "PANCHO"),
  base("Pancho con doble salchicha y cheddar", "MIXTA", "HERVIDO", 20, 43, 30, 2, 1510, 2900, 20, "FACIL", "dos salchichas, pan, cheddar y mayonesa", "Calentar las salchichas, cubrir con cheddar y servir en pan", "AMBOS", "PANCHO"),
  base("Pancho alemán con salchicha ahumada", "MIXTA", "HERVIDO", 17, 42, 28, 2, 1480, 2800, 25, "FACIL", "salchicha ahumada, pan, chucrut y mostaza", "Calentar la salchicha y servir en pan con chucrut y mostaza", "AMBOS", "PANCHO"),
  base("Pancho con salchicha parrillera y chimichurri", "MIXTA", "PARRILLA", 18, 44, 31, 2, 1420, 3000, 30, "MEDIA", "salchicha parrillera, pan, chimichurri y mayonesa", "Cocinar la salchicha a la parrilla y servir en pan con aderezos", "AMBOS", "PANCHO"),
  base("Pancho XL con salchicha, jamón y queso", "MIXTA", "HERVIDO", 22, 47, 31, 2, 1580, 3300, 25, "FACIL", "salchicha grande, pan, jamón, queso y salsa golf", "Calentar la salchicha y montar con jamón, queso y salsa golf", "CENA", "PANCHO"),
  base("Lomito completo de carne con huevo", "VACUNA", "PLANCHA", 36, 48, 32, 3, 1110, 4500, 35, "MEDIA", "lomo, pan, huevo, jamón, queso, lechuga y mayonesa", "Cocinar el lomo y el huevo y montar el sándwich con los agregados", "AMBOS", "LOMITO"),
  base("Lomito de cerdo con queso y cebolla", "CERDO", "PLANCHA", 31, 47, 30, 3, 1040, 4100, 35, "MEDIA", "cerdo, pan, queso, cebolla y mayonesa", "Cocinar el cerdo y la cebolla y montar con queso y mayonesa", "AMBOS", "LOMITO"),
  base("Lomito de pollo crispy con jamón", "POLLO", "FRITURA", 32, 54, 31, 3, 1180, 3900, 40, "MEDIA", "pollo rebozado, pan, jamón, queso y aderezo", "Freír el pollo rebozado y montar con jamón, queso y aderezo", "AMBOS", "LOMITO"),
  base("Lomito completo con panceta y doble queso", "VACUNA", "PLANCHA", 39, 48, 38, 3, 1360, 4900, 40, "MEDIA", "lomo, pan, panceta, doble queso y mayonesa", "Cocinar el lomo, dorar panceta y montar con doble queso", "CENA", "LOMITO"),
  base("Lomito a caballo con salsa criolla", "VACUNA", "PLANCHA", 37, 47, 34, 4, 1130, 4550, 40, "MEDIA", "lomo, pan, huevo, tomate, cebolla y mayonesa", "Cocinar el lomo y el huevo y servir con salsa criolla", "AMBOS", "LOMITO"),
  base("Milanesa frita napolitana de carne", "VACUNA", "FRITURA", 34, 43, 34, 3, 1280, 3700, 40, "MEDIA", "carne, pan rallado, huevo, jamón, mozzarella y tomate", "Rebozar y freír la carne, cubrir con jamón y queso y gratinar", "AMBOS", "FRITO"),
  base("Milanesa frita de pollo con salsa de cuatro quesos", "POLLO", "FRITURA", 32, 45, 36, 3, 1390, 3650, 40, "MEDIA", "pollo, pan rallado, huevo, crema y quesos", "Freír la milanesa y cubrir con salsa caliente de quesos", "AMBOS", "FRITO"),
  base("Milanesa frita de cerdo a la fugazzeta", "CERDO", "FRITURA", 31, 44, 36, 3, 1370, 3650, 40, "MEDIA", "cerdo, rebozado, huevo, cebolla y mozzarella", "Freír la milanesa y gratinar con cebolla salteada y mozzarella", "CENA", "FRITO"),
  base("Milanesa frita de carne a caballo", "VACUNA", "FRITURA", 37, 44, 35, 3, 1310, 3900, 40, "MEDIA", "carne, pan rallado, huevo, aceite y papas", "Freír la milanesa y el huevo y servir juntos", "AMBOS", "FRITO"),
  base("Milanesa frita de pollo con jamón y cheddar", "POLLO", "FRITURA", 34, 46, 36, 3, 1450, 3800, 40, "MEDIA", "pollo, rebozado, jamón, cheddar y aceite", "Freír el pollo rebozado y cubrir con jamón y cheddar fundido", "AMBOS", "FRITO"),
  base("Empanadas fritas de carne cortada a cuchillo", "VACUNA", "FRITURA", 21, 42, 28, 2, 1140, 2900, 45, "MEDIA", "masa, carne, cebolla, huevo, grasa y sal", "Rellenar las tapas y freír en tandas hasta dorar", "AMBOS", "EMPANADA"),
  base("Empanadas fritas de pollo con salsa cremosa", "POLLO", "FRITURA", 20, 43, 27, 2, 1080, 2700, 45, "MEDIA", "masa, pollo, crema, cebolla, huevo y aceite", "Rellenar las tapas y freír; servir con salsa cremosa", "AMBOS", "EMPANADA"),
  base("Empanadas fritas de jamón y mozzarella", "LACTEOS", "FRITURA", 19, 45, 29, 2, 1210, 2750, 40, "MEDIA", "masa, jamón, mozzarella y aceite", "Rellenar las tapas y freír hasta dorar y fundir el queso", "AMBOS", "EMPANADA"),
  base("Empanadas fritas de humita con queso", "LACTEOS", "FRITURA", 17, 48, 27, 3, 1150, 2600, 45, "MEDIA", "masa, choclo, salsa blanca, queso y aceite", "Rellenar con humita y queso y freír en tandas", "AMBOS", "EMPANADA"),
  base("Nuggets de pollo rebozados con salsa", "POLLO", "FRITURA", 25, 48, 28, 2, 1260, 3200, 30, "FACIL", "pollo procesado, rebozado, huevo, aceite y salsa", "Freír los nuggets hasta que queden dorados y cocidos en el centro", "AMBOS", "FRITO"),
  base("Alitas de pollo fritas con barbacoa", "POLLO", "FRITURA", 28, 39, 34, 2, 1420, 3500, 45, "MEDIA", "alitas, harina, aceite y salsa barbacoa", "Rebozar las alitas, freír completamente y cubrir con barbacoa", "AMBOS", "FRITO"),
  base("Bastones de pollo fritos con cheddar", "POLLO", "FRITURA", 27, 46, 31, 2, 1350, 3400, 35, "FACIL", "pollo, rebozado, aceite, cheddar y salsa", "Cortar, rebozar y freír el pollo; servir con cheddar fundido", "AMBOS", "FRITO"),
  base("Sándwich triple de jamón, queso y mayonesa", "MIXTA", "SIN_COCCION" as CookingMethod, 24, 57, 31, 3, 1280, 3100, 20, "FACIL", "pan blanco, jamón, queso, huevo y mayonesa", "Armar tres capas de pan con jamón, queso, huevo y mayonesa", "AMBOS", "PANCHO"),
  base("Sándwich tostado de lomito y mozzarella", "VACUNA", "PLANCHA", 28, 49, 29, 2, 1190, 3300, 25, "FACIL", "pan blanco, lomito, mozzarella, manteca y aderezo", "Rellenar el pan, untar con manteca y tostar hasta fundir el queso", "AMBOS", "PANCHO"),
  base("Sándwich de milanesa con lechuga y tomate", "VACUNA", "FRITURA", 31, 56, 32, 4, 1250, 3500, 35, "MEDIA", "milanesa rebozada, pan, lechuga, tomate y mayonesa", "Freír la milanesa y servir en pan con vegetales y mayonesa", "AMBOS", "LOMITO"),
  base("Sándwich de pollo frito con salsa tártara", "POLLO", "FRITURA", 29, 55, 31, 3, 1280, 3500, 35, "MEDIA", "pollo, pan, rebozado, huevo y salsa tártara", "Rebozar y freír el pollo y montar en pan con salsa tártara", "AMBOS", "LOMITO"),
  base("Sándwich de bondiola desmenuzada y barbacoa", "CERDO", "GUISADO", 28, 57, 32, 3, 1320, 3650, 70, "MEDIA", "bondiola, pan, salsa barbacoa, azúcar y cebolla", "Cocinar la bondiola lentamente, desmenuzar y servir con barbacoa", "AMBOS", "LOMITO"),
  base("Pasta rellena con crema, jamón y queso", "MIXTA", "HERVIDO", 25, 61, 32, 3, 1320, 3200, 35, "FACIL", "ravioles, crema, jamón, queso rallado y manteca", "Hervir la pasta y mezclar con crema, jamón y queso", "AMBOS", "PASTA"),
  base("Fideos con salsa rosa, salchicha y crema", "MIXTA", "HERVIDO", 22, 63, 31, 3, 1310, 2900, 35, "FACIL", "fideos, salchicha, crema, tomate y queso", "Hervir los fideos y mezclar con salsa rosa y salchicha dorada", "AMBOS", "PASTA"),
  base("Ñoquis con salsa cuatro quesos", "LACTEOS", "HERVIDO", 21, 65, 31, 3, 1280, 3000, 35, "FACIL", "ñoquis, crema, mozzarella, cheddar y queso rallado", "Hervir los ñoquis y cubrir con salsa caliente de cuatro quesos", "AMBOS", "PASTA"),
  base("Combo de pollo frito, pan blanco y salsa", "POLLO", "FRITURA", 31, 51, 35, 3, 1470, 4000, 45, "MEDIA", "pollo, harina, pan blanco, aceite y salsa industrial", "Rebozar y freír el pollo completamente y servir con pan y salsa", "AMBOS", "FRITO"),
  base("Combo de hamburguesa y papas con cheddar", "MIXTA", "FRITURA", 31, 62, 40, 4, 1560, 4750, 40, "MEDIA", "carne, pan, papas, cheddar, aceite y mayonesa", "Cocinar la hamburguesa, freír las papas y servir con cheddar y mayonesa", "CENA", "LOMITO")
];

function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-AR")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

function makeComida(base: MealBase, side: Side, id: number, category: MealCategory): Comida {
  const name = `${base.name} con ${side.name}`;
  const proteinGrams = base.proteinGrams + side.protein;
  const carbohydrateGrams = base.carbohydrateGrams + side.carbs;
  const fatGrams = base.fatGrams + side.fat;
  const vegetarian = ["HUEVO", "LEGUMBRES", "VEGETAL", "LACTEOS"].includes(base.proteinSource);
  const containsFish = base.proteinSource === "PESCADO" || base.proteinSource === "ATUN";
  const containsLegumes = base.proteinSource === "LEGUMBRES";
  const containsMeat = ["POLLO", "VACUNA", "CERDO", "MIXTA"].includes(base.proteinSource);
  const portion = category === "NUTRICIONAL"
    ? "1 plato institucional de 450 g"
    : base.variantGroup === "PIZZA" ? "2 porciones de pizza (450 g)"
      : base.variantGroup === "EMPANADA" ? "2 empanadas fritas con guarnición (450 g)"
        : base.variantGroup === "PANCHO" ? "1 pancho con guarnición (450 g)"
          : "1 plato combinado (500 g)";
  const calories = Math.round((proteinGrams * 4 + carbohydrateGrams * 4 + fatGrams * 9) * 100) / 100;
  const lowQualityNote = "Comida de baja calidad nutricional y consumo ocasional; no se presenta como una opción saludable.";
  const estimatedNote = "Valores nutricionales y costo orientativos por porción; deben validarse con la receta institucional y actualizarse con precios de compra.";
  return {
    id: String(id).padStart(3, "0"), name, normalizedName: normalizeName(name), category,
    mealService: base.mealService,
    description: category === "NUTRICIONAL"
      ? `Plato preparado de ${base.name.toLocaleLowerCase("es-AR")} con ${side.name}, pensado para producción institucional por tandas.`
      : `Preparación de comida rápida de baja calidad nutricional: ${base.name.toLocaleLowerCase("es-AR")} con ${side.name}.`,
    ingredients: `${base.ingredients}; ${side.ingredients}.`,
    preparation: `${base.preparation} ${side.preparation}, controlar la cocción y servir en porción individual.`,
    portion, calories, proteinGrams, carbohydrateGrams, fatGrams,
    fiberGrams: base.baseFiber + side.fiber,
    sodiumMilligrams: base.baseSodium + side.sodium,
    preparationMinutes: base.preparationMinutes,
    difficulty: base.difficulty,
    estimatedCost: base.baseCost + side.cost,
    currency: "ARS",
    suitableForCanteen: true,
    observations: category === "NUTRICIONAL" ? estimatedNote : `${lowQualityNote} ${estimatedNote}`,
    proteinSource: base.proteinSource,
    cookingMethod: base.cookingMethod,
    vegetarian,
    containsMeat,
    containsFish,
    containsLegumes
  };
}

function expandBases(bases: MealBase[], sidesFor: (base: MealBase) => Side[], startId: number, category: MealCategory): Comida[] {
  return bases.flatMap((base, baseIndex) => sidesFor(base).map((side, sideIndex) =>
    makeComida(base, side, startId + baseIndex * 5 + sideIndex, category)
  ));
}

if (nutritionalBases.length !== 50 || junkBases.length !== 50) {
  throw new Error("El catálogo de comidas requiere exactamente 50 preparaciones base por categoría.");
}

export const comidas: Comida[] = [
  ...expandBases(nutritionalBases, () => nutritionalSides, 1, "NUTRICIONAL"),
  ...expandBases(junkBases, (base) => junkSides[base.variantGroup ?? "LOMITO"], 251, "CHATARRA")
];