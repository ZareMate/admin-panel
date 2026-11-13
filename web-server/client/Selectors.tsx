import {useSlidingSelector} from './useSlidingSelector';
import type {ReactNode} from 'react';
import './selectors.css';

export interface SelectorOption {className?:string;value:string;label:ReactNode;icon?:ReactNode;id?:string;disabled?:boolean;ariaLabel?:string;title?:string}
/** Controlled single- and multiple-choice selectors share appearance and accessibility. */
export function ToggleSelector({label,options,value,onChange,multiple=false,variant='filter',className='',dataAttribute}:{label:string;options:SelectorOption[];value:string|readonly string[];onChange:(value:string)=>void;multiple?:boolean;variant?:'filter'|'tabs';className?:string;dataAttribute?:'data-filter'|'data-tab'}) {
 const slider=useSlidingSelector(String(value),!multiple);
 return <div ref={slider} className={`selector-group ${multiple?'':'sliding-selector'} ${variant==='tabs'?'detail-tabs':'filter-tabs'} ${className}`} role="group" aria-label={label}>{options.map(option=>{
  const selected=multiple?Array.isArray(value)&&value.includes(option.value):value===option.value;
  return <button key={option.value} id={option.id} type="button" aria-label={option.ariaLabel} title={option.title} className={[selected?(variant==='tabs'?'active':'selected'):'',option.className].filter(Boolean).join(' ')} aria-pressed={selected} disabled={option.disabled} {...(dataAttribute?{[dataAttribute]:option.value}:{})} onClick={()=>onChange(option.value)}>{option.icon}{option.label}</button>;
 })}{!multiple&&<span className="selector-highlight" aria-hidden="true" hidden/>}</div>;
}
export function SelectField({label,ariaLabel,options,value,onChange}:{label:string;ariaLabel?:string;options:{value:string;label:string}[];value:string;onChange:(value:string)=>void}) {
 return <label className="select-field">{label}<select aria-label={ariaLabel||label} value={value} onChange={event=>onChange(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
