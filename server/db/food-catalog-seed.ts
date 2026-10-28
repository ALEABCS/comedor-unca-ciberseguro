import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { foodTypeForCategory } from "../../shared/food-catalog";
import { seedComidas } from "./comidas-seed";

const categories = [
  { code: "PASTAS", label: "Pastas", items: "Fideos tipo tallarín|Fideos tipo spaghetti|Fideos tipo moño|Fideos tipo tirabuzón|Fideos tipo penne|Fideos integrales|Ñoquis de papa|Ñoquis de calabaza|Ravioles de verdura|Ravioles de ricota|Ravioles de carne|Ravioles de pollo|Sorrentinos de jamón y queso|Sorrentinos de calabaza|Canelones de verdura|Canelones de carne|Lasagna de carne|Lasagna de verdura|Tapa para lasagna|Masa para canelones" },
  { code: "TARTAS", label: "Tartas y empanadas", items: "Tarta de acelga|Tarta de zapallitos|Tarta de calabaza|Tarta de choclo|Tarta de cebolla|Tarta de puerro|Tarta de verduras|Tarta de pollo|Tarta de atún|Tarta de jamón y queso|Empanada de carne|Empanada de pollo|Empanada de jamón y queso|Empanada de verdura|Empanada de choclo|Masa para tarta|Masa para empanadas|Tarta de berenjena|Tarta de tomate|Tarta de champiñones" },
  { code: "CARNES", label: "Carnes y huevos", items: "Carne vacuna en cubos|Carne vacuna molida|Carne vacuna para horno|Carne vacuna para milanesa|Carne vacuna para guiso|Bife de carne vacuna|Pollo entero|Pechuga de pollo|Muslo de pollo|Pollo deshuesado|Carne de cerdo|Costilla de cerdo|Carne de cordero|Pescado fresco|Filete de merluza|Atún en conserva|Huevo de gallina|Clara de huevo|Carne picada de pollo|Carne vacuna para estofado" },
  { code: "VERDURAS", label: "Verduras y hortalizas", items: "Acelga|Achicoria|Ajo|Apio|Berenjena|Brócoli|Calabaza|Cebolla|Cebolla de verdeo|Chaucha|Choclo|Coliflor|Espinaca|Lechuga|Morrón|Papa|Pepino|Repollo|Tomate|Zanahoria" },
  { code: "FRUTAS", label: "Frutas", items: "Manzana|Banana|Naranja|Mandarina|Pera|Durazno|Ciruela|Uva|Frutilla|Limón|Pomelo|Melón|Sandía|Kiwi|Ananá|Mango|Palta|Cereza|Arándano|Damasco" },
  { code: "GUARNICIONES", label: "Guarniciones y cereales", items: "Arroz blanco|Arroz integral|Polenta|Puré de papa|Puré de calabaza|Papas al horno|Papas hervidas|Batata al horno|Batata hervida|Ensalada de arroz|Ensalada de papa|Quinoa|Lentejas cocidas|Garbanzos cocidos|Porotos cocidos|Cuscús|Choclo desgranado|Tortilla de papa|Mandioca hervida|Fideos de arroz" },
  { code: "SOPAS", label: "Sopas y preparaciones", items: "Sopa de verduras|Sopa de zapallo|Sopa de cebolla|Sopa de tomate|Caldo de verduras|Caldo de pollo|Guiso de lentejas|Guiso de arroz|Guiso de fideos|Estofado de carne|Estofado de pollo|Locro|Carbonada|Puchero|Risotto de verduras|Arroz con pollo|Polenta con salsa|Tortilla de acelga|Revuelto de verduras|Hamburguesa casera" },
  { code: "LACTEOS", label: "Lácteos y derivados", items: "Leche|Leche descremada|Yogur natural|Yogur frutado|Queso cremoso|Queso mozzarella|Queso rallado|Queso fresco|Ricota|Crema de leche|Manteca|Dulce de leche|Postre de vainilla|Flan|Gelatina|Helado|Leche en polvo|Queso untable|Yogur bebible|Postre de chocolate" },
  { code: "PANIFICADOS", label: "Panificados y secos", items: "Pan francés|Pan integral|Pan rallado|Galletas de agua|Galletas dulces|Harina de trigo|Harina de maíz|Harina de arroz|Avena arrollada|Fécula de maíz|Azúcar|Sal fina|Aceite de girasol|Aceite de oliva|Vinagre|Puré de tomate|Salsa de tomate|Mayonesa|Mostaza|Mermelada" },
  { code: "BEBIDAS", label: "Bebidas", items: "Agua|Agua con gas|Jugo de naranja|Jugo de manzana|Jugo de durazno|Limonada|Licuado de banana|Licuado de frutilla|Té|Té de hierbas|Café|Mate cocido|Leche chocolatada|Bebida de soja|Bebida de avena|Bebida de almendras|Refresco sabor cola|Refresco sabor lima limón|Agua saborizada|Jugo de pomelo" },
  { code: "PLATOS_NUTRICIONALES", label: "Platos nutricionales", items: "" },
  { code: "PLATOS_CHATARRA", label: "Platos de baja calidad nutricional", items: "" }
] as const;

const allergens = [
  ["GLUTEN", "Gluten"], ["CRUSTACEOS", "Crustáceos"], ["HUEVO", "Huevo"],
  ["PESCADO", "Pescado"], ["CACAHUATES", "Maní"], ["SOJA", "Soja"],
  ["LECHE", "Leche"], ["FRUTOS_DE_CASCARA", "Frutos de cáscara"],
  ["APIO", "Apio"], ["MOSTAZA", "Mostaza"], ["SESAMO", "Sésamo"],
  ["SULFITOS", "Sulfitos"], ["ALTRAMUCES", "Altramuces"], ["MOLUSCOS", "Moluscos"]
] as const;

function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-AR")
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

export async function seedFoodCatalog(connection: PoolConnection): Promise<number> {
  for (const category of categories) {
    await connection.execute(
      "INSERT IGNORE INTO food_categories (code, label) VALUES (?, ?)",
      [category.code, category.label]
    );
  }
  for (const [code, label] of allergens) {
    await connection.execute("INSERT IGNORE INTO food_allergens (code, label) VALUES (?, ?)", [code, label]);
  }

  let inserted = 0;
  for (const category of categories) {
    for (const name of category.items.split("|")) {
      if (!name.trim()) continue;
      const foodType = foodTypeForCategory(category.code);
      const [result] = await connection.execute(
        `INSERT IGNORE INTO foods (id, name, normalized_name, category_code, food_type, allergens_verified)
         VALUES (?, ?, ?, ?, ?, FALSE)`,
        [randomUUID(), name, normalizeName(name), category.code, foodType]
      );
      if ("affectedRows" in result) inserted += result.affectedRows;
      if (foodType !== "ALIMENTO") {
        await connection.execute(
          `UPDATE foods SET food_type = ?
           WHERE category_code = ? AND normalized_name = ? AND food_type = 'ALIMENTO'`,
          [foodType, category.code, normalizeName(name)]
        );
      }
    }
  }
  return inserted + await seedComidas(connection);
}
