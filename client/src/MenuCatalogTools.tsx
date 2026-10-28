import { useEffect, useState, type FormEvent } from "react";
import { Archive, Check, ChevronDown, ChevronLeft, ChevronRight, Edit3, Plus, Search, Utensils, X } from "lucide-react";
import { trpc } from "./trpc";
import { foodTypeForCategory } from "../../shared/food-catalog";

type MenuService = "ALMUERZO" | "CENA";
type GenerationPeriod = "DAILY" | "WEEKLY" | "MONTHLY";
type DietFilter = "ALL" | "YES" | "NO" | "UNKNOWN";
type DietaryValue = boolean | null;
type MenuFood = {
  foodId: string;
  foodName: string;
  component: string;
  sortOrder: number;
};
type MenuDraft = {
  date: string;
  service: MenuService;
  title: string;
  description: string;
  published: boolean;
  items: MenuFood[];
  ingredients: string;
  mainDish: string;
  sideDish: string;
  salad: string;
  dessert: string;
  drink: string;
  bread: string;
  nutritionalInformation: string;
  notes: string;
};
type FoodForm = {
  id?: string;
  name: string;
  categoryCode: string;
  subcategory: string;
  foodType: "ALIMENTO" | "PREPARACION" | "BEBIDA";
  description: string;
  sinTacc: DietaryValue;
  vegan: DietaryValue;
  vegetarian: DietaryValue;
  allergensVerified: boolean;
  allergenCodes: string[];
  calories: string;
  proteinGrams: string;
  carbohydrateGrams: string;
  fatGrams: string;
  fiberGrams: string;
  sodiumMilligrams: string;
};

const emptyFood = (): FoodForm => ({
  name: "", categoryCode: "", subcategory: "", foodType: "ALIMENTO", description: "",
  sinTacc: null, vegan: null, vegetarian: null, allergensVerified: false, allergenCodes: [],
  calories: "", proteinGrams: "", carbohydrateGrams: "", fatGrams: "", fiberGrams: "", sodiumMilligrams: ""
});

const dietLabel = (value: unknown) => value === true || value === 1
  ? "Verificado: sí"
  : value === false || value === 0 ? "Verificado: no" : "Sin verificar";

const foodTypeLabel = (value: string) => value === "BEBIDA"
  ? "Bebida"
  : value === "PREPARACION" ? "Preparación" : "Alimento";

function asDietaryValue(value: string): DietaryValue {
  return value === "yes" ? true : value === "no" ? false : null;
}

export function MenuCatalogTools({ canManage, defaultDate }: { canManage: boolean; defaultDate: string }) {
  const [date, setDate] = useState(defaultDate);
  const [service, setService] = useState<MenuService>("ALMUERZO");
  const [draft, setDraft] = useState<MenuDraft | null>(null);
  const [foodForm, setFoodForm] = useState<FoodForm | null>(null);
  const [search, setSearch] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [dietFilters, setDietFilters] = useState<{ sinTacc: DietFilter; vegan: DietFilter; vegetarian: DietFilter }>({ sinTacc: "ALL", vegan: "ALL", vegetarian: "ALL" });
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [component, setComponent] = useState("Plato principal");
  const [selectionMessage, setSelectionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [generationPeriod, setGenerationPeriod] = useState<GenerationPeriod>("WEEKLY");
  const [nutritionalPercentage, setNutritionalPercentage] = useState(80);
  const [generationMessage, setGenerationMessage] = useState("");
  const catalogSearch = draft ? itemSearch : search;
  useEffect(() => setDate(defaultDate), [defaultDate]);
  const utils = trpc.useUtils();
  const categories = trpc.foodCatalog.categories.useQuery(undefined, { enabled: canManage });
  const allergens = trpc.foodCatalog.allergens.useQuery(undefined, { enabled: canManage });
  const foods = trpc.foodCatalog.list.useQuery({
    search: catalogSearch,
    categoryCode: draft ? undefined : categoryCode || undefined,
    ...(draft ? { sinTacc: "ALL" as const, vegan: "ALL" as const, vegetarian: "ALL" as const, includeInactive: false } : { ...dietFilters, includeInactive }),
    page, pageSize: 20
  }, { enabled: canManage });
  const menu = trpc.menu.list.useQuery({ from: date, to: date }, { enabled: canManage });
  const generatorSettings = trpc.menuGenerator.settings.useQuery(undefined, { enabled: canManage });
  useEffect(() => {
    if (generatorSettings.data) setNutritionalPercentage(generatorSettings.data.nutritionalPercentage);
  }, [generatorSettings.data]);
  const saveGeneratorSettings = trpc.menuGenerator.setNutritionalPercentage.useMutation({
    onSuccess: (result) => {
      setNutritionalPercentage(result.nutritionalPercentage);
      setGenerationMessage("Porcentaje de menú actualizado.");
      setErrorMessage("");
    },
    onError: (error) => setErrorMessage(error.message)
  });
  const generateMenus = trpc.menuGenerator.generate.useMutation({
    onSuccess: async (result) => {
      setGenerationMessage(`${result.generated} menús creados como borrador; ${result.skipped} servicios existentes conservados.`);
      setErrorMessage("");
      await utils.menu.list.invalidate();
    },
    onError: (error) => setErrorMessage(error.message)
  });
  const saveMenu = trpc.menu.save.useMutation({
    onSuccess: async () => {
      if (draft) {
        setDate(draft.date);
        setService(draft.service);
      }
      setDraft(null);
      setErrorMessage("");
      await utils.menu.list.invalidate();
    },
    onError: (error) => setErrorMessage(error.message)
  });
  const createFood = trpc.foodCatalog.create.useMutation({
    onSuccess: async (_result, input) => {
      setFoodForm(null);
      setErrorMessage("");
      setSearch("");
      setCategoryCode(input.categoryCode);
      setPage(1);
      await utils.foodCatalog.list.invalidate();
    },
    onError: (error) => setErrorMessage(error.message)
  });
  const updateFood = trpc.foodCatalog.update.useMutation({
    onSuccess: async (_result, input) => {
      setFoodForm(null);
      setErrorMessage("");
      setSearch("");
      setCategoryCode(input.categoryCode);
      setPage(1);
      await utils.foodCatalog.list.invalidate();
    },
    onError: (error) => setErrorMessage(error.message)
  });
  const setFoodActive = trpc.foodCatalog.setActive.useMutation({
    onSuccess: async () => { setErrorMessage(""); await utils.foodCatalog.list.invalidate(); },
    onError: (error) => setErrorMessage(error.message)
  });

  if (!canManage) return null;

  const openDraft = (entry?: NonNullable<typeof menu.data>[number]) => {
    setErrorMessage("");
    setSelectionMessage("");
    setPage(1);
    setItemSearch("");
    setDraft(entry ? {
      date: String(entry.serviceDate).slice(0, 10),
      service: entry.service as MenuService,
      title: String(entry.title),
      description: String(entry.description ?? ""),
      published: Boolean(entry.published),
      items: entry.items.map((item) => ({
        foodId: String(item.foodId), foodName: String(item.foodName),
        component: String(item.component), sortOrder: Number(item.sortOrder)
      })),
      ingredients: String(entry.ingredients ?? ""),
      mainDish: String(entry.mainDish ?? ""),
      sideDish: String(entry.sideDish ?? ""),
      salad: String(entry.salad ?? ""),
      dessert: String(entry.dessert ?? ""),
      drink: String(entry.drink ?? ""),
      bread: String(entry.bread ?? ""),
      nutritionalInformation: String(entry.nutritionalInformation ?? ""),
      notes: String(entry.notes ?? "")
    } : {
      date, service, title: "", description: "", published: false, items: [],
      ingredients: "", mainDish: "", sideDish: "", salad: "", dessert: "", drink: "", bread: "",
      nutritionalInformation: "", notes: ""
    });
  };

  const openFood = (item?: NonNullable<typeof foods.data>["items"][number]) => {
    setErrorMessage("");
    setFoodForm(item ? {
      id: String(item.id),
      name: String(item.name),
      categoryCode: String(item.categoryCode),
      subcategory: String(item.subcategory ?? ""),
      foodType: item.foodType as FoodForm["foodType"],
      description: String(item.description ?? ""),
      sinTacc: item.sinTacc as DietaryValue,
      vegan: item.vegan as DietaryValue,
      vegetarian: item.vegetarian as DietaryValue,
      allergensVerified: Boolean(item.allergensVerified),
      allergenCodes: item.allergenCodes,
      calories: item.calories == null ? "" : String(item.calories),
      proteinGrams: item.proteinGrams == null ? "" : String(item.proteinGrams),
      carbohydrateGrams: item.carbohydrateGrams == null ? "" : String(item.carbohydrateGrams),
      fatGrams: item.fatGrams == null ? "" : String(item.fatGrams),
      fiberGrams: item.fiberGrams == null ? "" : String(item.fiberGrams),
      sodiumMilligrams: item.sodiumMilligrams == null ? "" : String(item.sodiumMilligrams)
    } : emptyFood());
  };

  const submitFood = (event: FormEvent) => {
    event.preventDefault();
    if (!foodForm) return;
    const payload = {
      name: foodForm.name,
      categoryCode: foodForm.categoryCode,
      subcategory: foodForm.subcategory || null,
      foodType: foodForm.foodType,
      description: foodForm.description || null,
      sinTacc: foodForm.sinTacc,
      vegan: foodForm.vegan,
      vegetarian: foodForm.vegetarian,
      allergensVerified: foodForm.allergensVerified,
      allergenCodes: foodForm.allergenCodes,
      calories: foodForm.calories === "" ? null : Number(foodForm.calories),
      proteinGrams: foodForm.proteinGrams === "" ? null : Number(foodForm.proteinGrams),
      carbohydrateGrams: foodForm.carbohydrateGrams === "" ? null : Number(foodForm.carbohydrateGrams),
      fatGrams: foodForm.fatGrams === "" ? null : Number(foodForm.fatGrams),
      fiberGrams: foodForm.fiberGrams === "" ? null : Number(foodForm.fiberGrams),
      sodiumMilligrams: foodForm.sodiumMilligrams === "" ? null : Number(foodForm.sodiumMilligrams)
    };
    if (foodForm.id) updateFood.mutate({ ...payload, id: foodForm.id });
    else createFood.mutate(payload);
  };

  const addFoodToDraft = (foodId: string) => {
    const food = foods.data?.items.find((item) => String(item.id) === foodId);
    const foodName = String(food?.name ?? "Alimento");
    const selectedComponent = component.trim() || "Acompañamiento";
    setDraft((current) => {
      if (!current || current.items.some((item) => item.foodId === foodId)) return current;
      return {
        ...current,
        items: [...current.items, {
          foodId, foodName,
          component: selectedComponent, sortOrder: current.items.length
        }]
      };
    });
    setSelectionMessage(`${foodName} agregado al menú.`);
  };

  return <section className="surface-card catalog-tools">
    <div className="surface-heading">
      <div><span className="eyebrow">PLANIFICACIÓN Y CATÁLOGO</span><h3>Constructor de menú y alimentos</h3></div>
      <button className="button button-primary" onClick={() => openDraft()}><Plus size={16} /> Nuevo menú estructurado</button>
    </div>
    <p className="catalog-intro">Armá cada servicio con componentes del catálogo. Los datos dietarios y los alérgenos sin verificar se muestran como desconocidos; no se presumen aptitudes.</p>
    {(categories.error || allergens.error) && <p className="form-error">{categories.error?.message ?? allergens.error?.message}</p>}
    <div className="menu-generator-controls">
      <div><span className="eyebrow">PLANIFICACIÓN AUTOMÁTICA</span><h4>Generar almuerzos y cenas</h4><p>Se crean como borradores, se omiten los servicios que ya tienen menú y deben revisarse antes de publicar.</p></div>
      <div className="menu-generator-fields">
        <label className="field">Desde<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="field">Período<select value={generationPeriod} onChange={(event) => setGenerationPeriod(event.target.value as GenerationPeriod)}><option value="DAILY">Diario</option><option value="WEEKLY">Semanal</option><option value="MONTHLY">Mensual (30 días)</option></select></label>
        <label className="field">Comidas nutricionales (%)<input type="number" min="0" max="100" step="1" value={nutritionalPercentage} onChange={(event) => setNutritionalPercentage(Number(event.target.value))} /></label>
        <button className="button button-secondary" type="button" disabled={saveGeneratorSettings.isPending || !Number.isInteger(nutritionalPercentage) || nutritionalPercentage < 0 || nutritionalPercentage > 100} onClick={() => saveGeneratorSettings.mutate({ percentage: nutritionalPercentage })}>{saveGeneratorSettings.isPending ? "Guardando…" : "Guardar porcentaje"}</button>
        <button className="button button-primary" type="button" disabled={generateMenus.isPending || generatorSettings.isLoading || !date} onClick={() => { setGenerationMessage(""); setErrorMessage(""); generateMenus.mutate({ startDate: date, period: generationPeriod }); }}>{generateMenus.isPending ? "Generando…" : "Generar borradores"}</button>
      </div>
      {generationMessage && <p className="catalog-status" role="status">{generationMessage}</p>}
      {generatorSettings.error && <p className="form-error">{generatorSettings.error.message}</p>}
    </div>
    <div className="catalog-date-row">
      <label className="field">Fecha de consulta<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setPage(1); }} /></label>
      <label className="field">Servicio<select value={service} onChange={(event) => setService(event.target.value as MenuService)}><option value="ALMUERZO">Almuerzo</option><option value="CENA">Cena</option></select></label>
      <button className="button button-secondary" onClick={() => openDraft()}>Crear menú de este servicio</button>
    </div>
    {menu.isLoading ? <p className="catalog-status">Consultando los menús de la fecha…</p> : menu.error ? <p className="form-error">{menu.error.message}</p> : <div className="catalog-existing-menus">
      <strong>Menús registrados para la fecha</strong>
      {!menu.data?.length ? <span>No hay menús. Podés crear uno estructurado.</span> : menu.data.map((entry) => <div className="catalog-menu-row" key={String(entry.id)}>
        <span><b>{entry.service === "ALMUERZO" ? "Almuerzo" : "Cena"}</b> · {String(entry.title)} · {entry.published ? "Publicado" : "Borrador"} · {entry.items.length} componentes</span>
        <button className="table-action" onClick={() => openDraft(entry)}><Edit3 size={14} /> Editar estructura</button>
      </div>)}
    </div>}

    <div className="catalog-section-head"><div><span className="eyebrow">BIBLIOTECA</span><h4>Alimentos ({foods.data?.total ?? 0})</h4></div><button className="button button-secondary" onClick={() => openFood()}><Plus size={15} /> Agregar alimento</button></div>
    <div className="catalog-filters">
      <label className="catalog-search"><Search size={16} /><input value={search} maxLength={100} placeholder="Buscar alimento o preparación" onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
      <label className="field">Categoría<select value={categoryCode} onChange={(event) => { setCategoryCode(event.target.value); setPage(1); }}><option value="">Todas</option>{categories.data?.map((item) => <option key={String(item.code)} value={String(item.code)}>{String(item.label)}</option>)}</select></label>
      {(["sinTacc", "vegan", "vegetarian"] as const).map((key) => <label className="field" key={key}>{key === "sinTacc" ? "Sin TACC" : key === "vegan" ? "Vegano" : "Vegetariano"}<select value={dietFilters[key]} onChange={(event) => { setDietFilters({ ...dietFilters, [key]: event.target.value as typeof dietFilters[typeof key] }); setPage(1); }}><option value="ALL">Todos</option><option value="YES">Verificado: sí</option><option value="NO">Verificado: no</option><option value="UNKNOWN">Sin verificar</option></select></label>)}
      <label className="checkbox-field"><input type="checkbox" checked={includeInactive} onChange={(event) => { setIncludeInactive(event.target.checked); setPage(1); }} /> Incluir inactivos</label>
    </div>
    {foods.isLoading ? <p className="catalog-status">Cargando catálogo…</p> : foods.error ? <p className="form-error">{foods.error.message}</p> : !foods.data?.items.length ? <p className="catalog-status">No hay alimentos para estos filtros.</p> : <div className="catalog-food-list">{foods.data.items.map((item) => <article className={`catalog-food-row ${item.active ? "" : "catalog-food-inactive"}`} key={String(item.id)}>
      <div className="catalog-food-main"><strong>{String(item.name)}</strong><span>{foodTypeLabel(String(item.foodType))} · {String(item.categoryLabel)}{item.subcategory ? ` · ${String(item.subcategory)}` : ""}{!item.active && " · Inactivo"}</span>
        <small>{dietLabel(item.sinTacc)} sin TACC · {dietLabel(item.vegan)} vegano · {dietLabel(item.vegetarian)} vegetariano · {item.allergensVerified ? `Alérgenos revisados: ${item.allergenCodes.length ? item.allergenCodes.map((code) => allergens.data?.find((allergen) => allergen.code === code)?.label ?? code).join(", ") : "ninguno declarado"}` : "Alérgenos sin verificar"}</small>
      </div>
      <div className="catalog-row-actions"><button className="table-action" onClick={() => openFood(item)}><Edit3 size={14} /> Editar</button>{draft && item.active && <button className="table-action" disabled={draft.items.some((selected) => selected.foodId === String(item.id))} onClick={() => addFoodToDraft(String(item.id))}><Plus size={14} /> Agregar</button>}<button className="table-action danger-action" onClick={() => setFoodActive.mutate({ id: String(item.id), active: !item.active })}><Archive size={14} /> {item.active ? "Desactivar" : "Reactivar"}</button></div>
    </article>)}</div>}
    <div className="catalog-pagination"><span>Página {page} · {foods.data?.total ?? 0} alimentos</span><div><button className="icon-button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="Página siguiente" disabled={page * 20 >= (foods.data?.total ?? 0)} onClick={() => setPage((value) => value + 1)}><ChevronRight size={17} /></button></div></div>
    {errorMessage && <p className="form-error catalog-error">{errorMessage}</p>}

    {draft && <div className="modal-backdrop" role="presentation"><section className="modal-card catalog-modal" role="dialog" aria-modal="true" aria-labelledby="menu-builder-title"><div className="modal-head"><h2 id="menu-builder-title">Constructor de menú</h2><button className="icon-button" aria-label="Cerrar constructor" onClick={() => setDraft(null)}><X size={18} /></button></div>
      <form className="modal-form" onSubmit={(event) => { event.preventDefault(); saveMenu.mutate(draft); }}>
        <div className="form-grid"><label className="field">Fecha<input type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label><label className="field">Servicio<select value={draft.service} onChange={(event) => setDraft({ ...draft, service: event.target.value as MenuService })}><option value="ALMUERZO">Almuerzo</option><option value="CENA">Cena</option></select></label></div>
        <label className="field">Nombre del menú<input required minLength={3} maxLength={180} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="field">Descripción<textarea rows={2} maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label className="field">Componente del menú<input maxLength={80} value={component} onChange={(event) => setComponent(event.target.value)} placeholder="Plato principal, guarnición…" /></label>
        <p className="catalog-hint"><Utensils size={15} /> Elegí alimentos desde el catálogo. El componente permite agrupar plato, guarnición, ensalada u otras partes.</p>
        <label className="catalog-search"><Search size={16} /><input value={itemSearch} maxLength={100} placeholder="Buscar en el catálogo" onChange={(event) => { setItemSearch(event.target.value); setPage(1); setSelectionMessage(""); }} /></label>
        {selectionMessage && <p className="catalog-selection-status" role="status">{selectionMessage}</p>}
        {foods.isLoading ? <p className="catalog-status">Cargando alimentos y preparaciones…</p> : foods.error ? <p className="form-error">{foods.error.message}</p> : !foods.data?.items.length ? <p className="catalog-status">No hay alimentos ni preparaciones para esta búsqueda. Probá con otro nombre.</p> : <div className="menu-builder-picks">{foods.data.items.map((item) => {
          const selected = draft.items.some((entry) => entry.foodId === String(item.id));
          return <button type="button" className={`menu-builder-pick${selected ? " menu-builder-pick-selected" : ""}`} key={String(item.id)} disabled={selected} aria-pressed={selected} onClick={() => addFoodToDraft(String(item.id))}><span>{String(item.name)}<small>{foodTypeLabel(String(item.foodType))} · {String(item.categoryLabel)}</small></span>{selected ? <Check size={14} /> : <Plus size={14} />}</button>;
        })}</div>}
        <section className="menu-builder-selected" aria-label="Alimentos seleccionados para el menú">
          <strong>Seleccionados para este menú ({draft.items.length})</strong>
          {draft.items.length ? <div className="menu-builder-items">{draft.items.map((selected, index) => {
            const foodName = selected.foodName;
            return <div className="menu-builder-item" key={`${selected.foodId}-${index}`}><span><small>{selected.component}</small><strong>{foodName}</strong></span><button type="button" className="icon-button" aria-label={`Quitar ${foodName}`} onClick={() => { setDraft((current) => current ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current); setSelectionMessage(`${foodName} quitado del menú.`); }}><X size={15} /></button></div>;
          })}</div> : <p className="catalog-status">Todavía no seleccionaste alimentos. Tocá una opción del catálogo para agregarla.</p>}
        </section>
        <div className="catalog-pagination"><span>{foods.data?.total ?? 0} alimentos encontrados</span><div><button type="button" className="icon-button" aria-label="Página anterior del catálogo" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={17} /></button><button type="button" className="icon-button" aria-label="Página siguiente del catálogo" disabled={page * 20 >= (foods.data?.total ?? 0)} onClick={() => setPage((value) => value + 1)}><ChevronRight size={17} /></button></div></div>
        <label className="checkbox-field"><input type="checkbox" checked={draft.published} onChange={(event) => setDraft({ ...draft, published: event.target.checked })} /> Publicar para usuarios</label>
        {errorMessage && <p className="form-error">{errorMessage}</p>}
        <button className="button button-primary button-full" disabled={saveMenu.isPending}>{saveMenu.isPending ? "Guardando…" : "Guardar menú"} <Utensils size={16} /></button>
      </form>
    </section></div>}

    {foodForm && <div className="modal-backdrop" role="presentation"><section className="modal-card catalog-modal" role="dialog" aria-modal="true" aria-labelledby="food-form-title"><div className="modal-head"><h2 id="food-form-title">{foodForm.id ? "Editar alimento" : "Nuevo alimento"}</h2><button className="icon-button" aria-label="Cerrar formulario" onClick={() => setFoodForm(null)}><X size={18} /></button></div>
      <form className="modal-form" onSubmit={submitFood}>
        <label className="field">Nombre<input required minLength={2} maxLength={160} value={foodForm.name} onChange={(event) => setFoodForm({ ...foodForm, name: event.target.value })} /></label>
        <div className="form-grid">
          <label className="field">Categoría
            <select required value={foodForm.categoryCode} disabled={categories.isLoading || Boolean(categories.error)} onChange={(event) => {
              const nextCategory = event.target.value;
              setFoodForm((current) => current && ({
                ...current,
                categoryCode: nextCategory,
                foodType: foodTypeForCategory(nextCategory)
              }));
            }}>
              <option value="">{categories.isLoading ? "Cargando categorías…" : categories.error ? "No se pudieron cargar" : "Seleccionar categoría"}</option>
              {categories.data?.map((item) => <option key={String(item.code)} value={String(item.code)}>{String(item.label)}</option>)}
            </select>
          </label>
          <label className="field">Tipo
            <select value={foodForm.foodType} onChange={(event) => {
              const nextType = event.target.value as FoodForm["foodType"];
              const beverageCategoryAvailable = categories.data?.some((item) => String(item.code) === "BEBIDAS") ?? false;
              setFoodForm((current) => current && ({
                ...current,
                foodType: nextType,
                categoryCode: nextType === "BEBIDA" && beverageCategoryAvailable
                  ? "BEBIDAS"
                  : nextType !== "BEBIDA" && current.categoryCode === "BEBIDAS" ? "" : current.categoryCode
              }));
            }}>
              <option value="ALIMENTO">Alimento</option>
              <option value="PREPARACION">Preparación</option>
              <option value="BEBIDA">Bebida</option>
            </select>
          </label>
        </div>
        <label className="field">Subcategoría<input maxLength={80} value={foodForm.subcategory} onChange={(event) => setFoodForm({ ...foodForm, subcategory: event.target.value })} /></label>
        <label className="field">Descripción<textarea rows={2} maxLength={2000} value={foodForm.description} onChange={(event) => setFoodForm({ ...foodForm, description: event.target.value })} /></label>
        <div className="form-grid">{(["sinTacc", "vegan", "vegetarian"] as const).map((key) => <label className="field" key={key}>{key === "sinTacc" ? "Sin TACC" : key === "vegan" ? "Vegano" : "Vegetariano"}<select value={foodForm[key] === null ? "unknown" : foodForm[key] ? "yes" : "no"} onChange={(event) => setFoodForm({ ...foodForm, [key]: asDietaryValue(event.target.value) })}><option value="unknown">Sin verificar</option><option value="yes">Verificado: sí</option><option value="no">Verificado: no</option></select></label>)}</div>
        <fieldset className="allergen-fieldset"><legend>Alérgenos declarados</legend>{allergens.data?.map((allergen) => <label className="checkbox-field" key={String(allergen.code)}><input type="checkbox" checked={foodForm.allergenCodes.includes(String(allergen.code))} onChange={(event) => setFoodForm({ ...foodForm, allergenCodes: event.target.checked ? [...foodForm.allergenCodes, String(allergen.code)] : foodForm.allergenCodes.filter((code) => code !== String(allergen.code)) })} /> {String(allergen.label)}</label>)}<label className="checkbox-field allergen-verified"><input type="checkbox" checked={foodForm.allergensVerified} onChange={(event) => setFoodForm({ ...foodForm, allergensVerified: event.target.checked })} /> Revisé y confirmé la información de alérgenos</label></fieldset>
        <p className="catalog-hint">Dejá los valores nutricionales vacíos hasta contar con una fuente institucional o del proveedor. El sistema no los estima.</p>
        <div className="form-grid">{([["calories", "Calorías"], ["proteinGrams", "Proteínas (g)"], ["carbohydrateGrams", "Carbohidratos (g)"], ["fatGrams", "Grasas (g)"], ["fiberGrams", "Fibra (g)"], ["sodiumMilligrams", "Sodio (mg)"]] as const).map(([key, label]) => <label className="field" key={key}>{label}<input type="number" min="0" step="0.01" value={foodForm[key]} onChange={(event) => setFoodForm({ ...foodForm, [key]: event.target.value })} /></label>)}</div>
        {errorMessage && <p className="form-error">{errorMessage}</p>}
        <button className="button button-primary button-full" disabled={createFood.isPending || updateFood.isPending}>{createFood.isPending || updateFood.isPending ? "Guardando…" : "Guardar alimento"} <Plus size={16} /></button>
      </form>
    </section></div>}
  </section>;
}

export function MenuStructuredDetails({ items }: { items: Array<Record<string, unknown>> }) {
  if (!items.length) return null;
  const components = new Map<string, Array<Record<string, unknown>>>();
  for (const item of items) {
    const componentName = String(item.component);
    components.set(componentName, [...(components.get(componentName) ?? []), item]);
  }
  return <details className="menu-structured-details">
    <summary><span><Utensils size={15} /> Ver ingredientes y componentes <small>{items.length}</small></span><ChevronDown size={16} /></summary>
    <div className="menu-structured-content">
      {[...components.entries()].map(([name, foods]) => <section className="structured-component" key={name}>
        <strong>{name}</strong>
        <ul>{foods.map((food) => {
          const allergens = Array.isArray(food.allergens) ? food.allergens.map(String) : [];
          return <li key={String(food.id)}>
            <span>{String(food.foodName)}</span>
            <small>Sin TACC: {dietLabel(food.sinTacc)} · Vegano: {dietLabel(food.vegan)} · Vegetariano: {dietLabel(food.vegetarian)}</small>
            <small>{food.allergensVerified ? `Alérgenos verificados: ${allergens.length ? allergens.join(", ") : "ninguno declarado"}` : "Alérgenos sin verificar"}</small>
          </li>;
        })}</ul>
      </section>)}
      <p className="catalog-hint">“Sin verificar” indica que no se cargaron datos confirmados; no representa una garantía de aptitud ni de ausencia de alérgenos.</p>
    </div>
  </details>;
}
