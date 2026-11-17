import {roleAttribute} from './inl-storage';

export const STATUS_ATTRIBUTE='custom-inl-status';
export const INL_STATUSES=['now','library','inbox'] as const;
export type InlStatus=typeof INL_STATUSES[number];
export const isStatus=(value:unknown):value is InlStatus=>INL_STATUSES.includes(value as InlStatus);

/** Content tags are deliberately absent from this model. */
export function initialStatus(attrs:Record<string,string>,path:string,box:string,notebooks:Record<string,{roles?:Record<string,string>}>,fallback:InlStatus='inbox'):InlStatus {
  if(isStatus(attrs[STATUS_ATTRIBUTE]))return attrs[STATUS_ATTRIBUTE];
  const parents=path.replace(/\.sy$/,'').split('/').filter(Boolean).slice(0,-1);
  for(const scope of [`${box}/`,...parents.map(id=>`${box}/${id}`)].reverse()) {
    const role=attrs[roleAttribute(scope)];if(isStatus(role))return role;
  }
  if(isStatus(attrs['custom-inl-role']))return attrs['custom-inl-role'];
  const root=notebooks['notebook:'+box]?.roles?.root;
  return isStatus(root)?root:fallback;
}
